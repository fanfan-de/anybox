use serde::Deserialize;
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, TryRecvError};
use std::thread;
use std::time::Duration;
use tungstenite::{Message, client};

const DEFAULT_AGENT_BASE_URL: &str = "http://127.0.0.1:4096";
const HOST_NAME: &str = "com.anybox.browser";
const RUNTIME_CONFIG_ENV: &str = "ANYBOX_BROWSER_NATIVE_CONFIG";
const RUNTIME_CONFIG_FILENAME: &str = "com.anybox.browser.runtime.json";
const MAX_NATIVE_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
const SOCKET_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Deserialize)]
struct RuntimeConfig {
    #[serde(rename = "agentBaseURL")]
    agent_base_url: Option<String>,
}

#[derive(Debug, PartialEq)]
struct AgentEndpoint {
    host: String,
    port: u16,
    authority: String,
    base_path: String,
}

enum ChromeInput {
    Message(Vec<u8>),
    End,
    Error(String),
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[anybox-chrome-native-host] {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let endpoint = parse_agent_base_url(&agent_base_url()?)?;
    let websocket_url = websocket_url(&endpoint);
    let stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port)).map_err(|error| {
        format!(
            "failed to connect to Anybox Agent at {}: {error}",
            endpoint.authority
        )
    })?;
    stream
        .set_nodelay(true)
        .map_err(|error| format!("failed to configure the Anybox Agent socket: {error}"))?;
    stream
        .set_read_timeout(Some(SOCKET_HANDSHAKE_TIMEOUT))
        .map_err(|error| format!("failed to configure the Anybox Agent socket timeout: {error}"))?;
    stream
        .set_write_timeout(Some(SOCKET_HANDSHAKE_TIMEOUT))
        .map_err(|error| format!("failed to configure the Anybox Agent socket timeout: {error}"))?;

    let (mut socket, response) = client(websocket_url.as_str(), stream)
        .map_err(|error| format!("failed to open the Anybox Agent websocket: {error}"))?;
    if response.status().as_u16() != 101 {
        return Err(format!(
            "Anybox Agent rejected the websocket upgrade with HTTP {}",
            response.status()
        ));
    }
    socket
        .get_mut()
        .set_read_timeout(Some(SOCKET_POLL_INTERVAL))
        .map_err(|error| format!("failed to configure the Anybox Agent socket timeout: {error}"))?;

    let (chrome_tx, chrome_rx) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_native_message(&mut input) {
                Ok(Some(message)) => {
                    if chrome_tx.send(ChromeInput::Message(message)).is_err() {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = chrome_tx.send(ChromeInput::End);
                    return;
                }
                Err(error) => {
                    let _ = chrome_tx.send(ChromeInput::Error(error.to_string()));
                    return;
                }
            }
        }
    });

    let stdout = io::stdout();
    let mut output = stdout.lock();

    loop {
        loop {
            match chrome_rx.try_recv() {
                Ok(ChromeInput::Message(payload)) => {
                    let text = String::from_utf8(payload).map_err(|_| {
                        "Chrome sent a Native Messaging payload that is not UTF-8".to_string()
                    })?;
                    socket
                        .send(Message::Text(text.into()))
                        .map_err(|error| format!("failed to forward a Chrome message: {error}"))?;
                }
                Ok(ChromeInput::End) => {
                    let _ = socket.close(None);
                    return Ok(());
                }
                Ok(ChromeInput::Error(error)) => {
                    let _ = socket.close(None);
                    return Err(format!(
                        "failed to read a Chrome Native Messaging frame: {error}"
                    ));
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Ok(()),
            }
        }

        match socket.read() {
            Ok(Message::Text(text)) => {
                write_native_message(&mut output, text.as_bytes()).map_err(|error| {
                    format!("failed to forward an Anybox Agent message: {error}")
                })?;
            }
            Ok(Message::Binary(payload)) => {
                write_native_message(&mut output, payload.as_ref()).map_err(|error| {
                    format!("failed to forward an Anybox Agent message: {error}")
                })?;
            }
            Ok(Message::Ping(payload)) => {
                socket.send(Message::Pong(payload)).map_err(|error| {
                    format!("failed to answer an Anybox Agent websocket ping: {error}")
                })?;
            }
            Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
            Ok(Message::Close(_)) => return Ok(()),
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                return Ok(());
            }
            Err(error) => return Err(format!("Anybox Agent websocket failed: {error}")),
        }
    }
}

fn read_native_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0_u8; 4];
    let mut offset = 0;
    while offset < header.len() {
        let bytes_read = reader.read(&mut header[offset..])?;
        if bytes_read == 0 {
            if offset == 0 {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Chrome closed stdin inside a Native Messaging frame header",
            ));
        }
        offset += bytes_read;
    }

    let message_length = u32::from_le_bytes(header) as usize;
    if message_length > MAX_NATIVE_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "Chrome Native Messaging payload is {message_length} bytes; maximum is {MAX_NATIVE_MESSAGE_BYTES}"
            ),
        ));
    }

    let mut payload = vec![0_u8; message_length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_native_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    let message_length = u32::try_from(payload.len()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Anybox Agent message is too large for Native Messaging",
        )
    })?;
    writer.write_all(&message_length.to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

fn agent_base_url() -> Result<String, String> {
    if let Some(explicit) = normalized_env("ANYBOX_AGENT_BASE_URL") {
        return Ok(explicit);
    }

    for candidate in runtime_config_candidates() {
        let Ok(contents) = fs::read_to_string(&candidate) else {
            continue;
        };
        let Ok(config) = serde_json::from_str::<RuntimeConfig>(&contents) else {
            continue;
        };
        if let Some(value) = config
            .agent_base_url
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(value);
        }
    }

    Ok(DEFAULT_AGENT_BASE_URL.to_string())
}

fn normalized_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn runtime_config_candidates() -> Vec<PathBuf> {
    runtime_config_candidates_for(
        normalized_env(RUNTIME_CONFIG_ENV),
        normalized_env("APPDATA"),
        normalized_env("USERPROFILE")
            .or_else(|| normalized_env("HOME"))
            .map(PathBuf::from),
        normalized_env("XDG_CONFIG_HOME").map(PathBuf::from),
    )
}

fn runtime_config_candidates_for(
    explicit: Option<String>,
    app_data: Option<String>,
    home: Option<PathBuf>,
    xdg_config_home: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = explicit {
        push_unique(&mut candidates, PathBuf::from(path));
    }

    if let Some(app_data) = app_data {
        for directory in ["Anybox", "anybox-desktop-agent"] {
            push_unique(
                &mut candidates,
                Path::new(&app_data)
                    .join(directory)
                    .join("native-messaging")
                    .join(RUNTIME_CONFIG_FILENAME),
            );
        }
    }

    if let Some(home) = home {
        let linux_config = xdg_config_home.unwrap_or_else(|| home.join(".config"));
        for directory in ["Anybox", "anybox-desktop-agent"] {
            push_unique(
                &mut candidates,
                home.join("Library")
                    .join("Application Support")
                    .join(directory)
                    .join("native-messaging")
                    .join(RUNTIME_CONFIG_FILENAME),
            );
            push_unique(
                &mut candidates,
                linux_config
                    .join(directory)
                    .join("native-messaging")
                    .join(RUNTIME_CONFIG_FILENAME),
            );
        }
    }

    candidates
}

fn push_unique(values: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !values.contains(&candidate) {
        values.push(candidate);
    }
}

fn parse_agent_base_url(value: &str) -> Result<AgentEndpoint, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.starts_with("https://") {
        return Err(
            "HTTPS Anybox Agent URLs are not supported by this local Native Messaging host"
                .to_string(),
        );
    }
    let remainder = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| format!("Anybox Agent URL must start with http://: {trimmed}"))?;
    let (authority, path) = remainder
        .split_once('/')
        .map_or((remainder, ""), |(authority, path)| (authority, path));
    if authority.is_empty() {
        return Err("Anybox Agent URL is missing a host".to_string());
    }

    let (host, port) = parse_authority(authority)?;
    let base_path = if path.is_empty() {
        String::new()
    } else {
        format!("/{}", path.trim_matches('/'))
    };
    Ok(AgentEndpoint {
        host,
        port,
        authority: authority.to_string(),
        base_path,
    })
}

fn parse_authority(authority: &str) -> Result<(String, u16), String> {
    if let Some(ipv6) = authority.strip_prefix('[') {
        let closing = ipv6.find(']').ok_or_else(|| {
            format!("Anybox Agent URL contains an invalid IPv6 host: {authority}")
        })?;
        let host = &ipv6[..closing];
        let suffix = &ipv6[closing + 1..];
        let port = if suffix.is_empty() {
            80
        } else {
            suffix
                .strip_prefix(':')
                .ok_or_else(|| format!("Anybox Agent URL contains an invalid port: {authority}"))?
                .parse::<u16>()
                .map_err(|_| format!("Anybox Agent URL contains an invalid port: {authority}"))?
        };
        return Ok((host.to_string(), port));
    }

    if let Some((host, port)) = authority.rsplit_once(':') {
        if host.is_empty() {
            return Err("Anybox Agent URL is missing a host".to_string());
        }
        let port = port
            .parse::<u16>()
            .map_err(|_| format!("Anybox Agent URL contains an invalid port: {authority}"))?;
        return Ok((host.to_string(), port));
    }

    Ok((authority.to_string(), 80))
}

fn websocket_url(endpoint: &AgentEndpoint) -> String {
    format!(
        "ws://{}{}{}?transport=native&hostName={HOST_NAME}",
        endpoint.authority, endpoint.base_path, "/api/browser-extension/ws"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn decodes_native_messaging_frames() {
        let payload = br#"{"type":"hello"}"#;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(payload);
        let mut cursor = Cursor::new(bytes);

        assert_eq!(
            read_native_message(&mut cursor).unwrap(),
            Some(payload.to_vec())
        );
        assert_eq!(read_native_message(&mut cursor).unwrap(), None);
    }

    #[test]
    fn encodes_native_messaging_frames() {
        let payload = br#"{"type":"command"}"#;
        let mut output = Vec::new();
        write_native_message(&mut output, payload).unwrap();

        assert_eq!(&output[..4], &(payload.len() as u32).to_le_bytes());
        assert_eq!(&output[4..], payload);
    }

    #[test]
    fn rejects_truncated_native_messaging_headers() {
        let mut cursor = Cursor::new(vec![1, 0]);
        let error = read_native_message(&mut cursor).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn resolves_runtime_config_candidates_in_priority_order() {
        let candidates = runtime_config_candidates_for(
            Some("C:/custom/config.json".to_string()),
            Some("C:/Users/test/AppData/Roaming".to_string()),
            Some(PathBuf::from("C:/Users/test")),
            None,
        );

        assert_eq!(candidates[0], PathBuf::from("C:/custom/config.json"));
        assert_eq!(
            candidates[1],
            PathBuf::from("C:/Users/test/AppData/Roaming")
                .join("Anybox")
                .join("native-messaging")
                .join(RUNTIME_CONFIG_FILENAME)
        );
    }

    #[test]
    fn parses_agent_urls_and_builds_the_websocket_url() {
        let endpoint = parse_agent_base_url("http://127.0.0.1:4567/base/").unwrap();
        assert_eq!(
            endpoint,
            AgentEndpoint {
                host: "127.0.0.1".to_string(),
                port: 4567,
                authority: "127.0.0.1:4567".to_string(),
                base_path: "/base".to_string(),
            }
        );
        assert_eq!(
            websocket_url(&endpoint),
            "ws://127.0.0.1:4567/base/api/browser-extension/ws?transport=native&hostName=com.anybox.browser"
        );
    }

    #[test]
    fn rejects_non_http_agent_urls() {
        assert!(parse_agent_base_url("https://127.0.0.1:4096").is_err());
        assert!(parse_agent_base_url("file:///tmp/agent").is_err());
    }
}
