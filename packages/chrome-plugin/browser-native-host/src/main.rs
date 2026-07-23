use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use interprocess::TryClone;
#[cfg(unix)]
use interprocess::local_socket::GenericFilePath;
use interprocess::local_socket::{GenericNamespaced, Stream as LocalSocketStream, prelude::*};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
#[cfg(test)]
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const BROWSER_IPC_PROTOCOL_VERSION: u32 = 1;
const BROWSER_IPC_ROLE: &str = "native-host";
const CHROME_EXTENSION_ID: &str = "mgpdddgemohfmonbnpehohhlbndakdpg";
const NATIVE_HOST_NAME: &str = "com.anybox.browser";
const RUNTIME_CONFIG_ENV: &str = "ANYBOX_BROWSER_NATIVE_CONFIG";
const RUNTIME_CONFIG_FILENAME: &str = "com.anybox.browser.runtime.json";
const MAX_NATIVE_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_NATIVE_OUTPUT_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_IPC_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_IPC_CHUNK_BYTES: usize = 512 * 1024;
const MAX_IPC_CHUNKS: usize = 128;

static TRANSFER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    transport: String,
    protocol_version: u32,
    native_host_endpoint: String,
    bootstrap_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapConfig {
    transport: String,
    protocol_version: u32,
    role: String,
    #[serde(rename = "brokerInstanceID")]
    broker_instance_id: String,
    endpoint: String,
    proof: String,
    expires_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeMessage {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u32,
    role: String,
    #[serde(rename = "brokerInstanceID")]
    broker_instance_id: String,
    nonce: String,
    expires_at: u64,
}

#[derive(Debug)]
enum BridgeInput {
    ChromeMessage(Vec<u8>),
    ChromeEnd,
    ChromeError(String),
    BrowserHostMessage(Value),
    BrowserHostEnd,
    BrowserHostError(String),
}

#[cfg(test)]
struct IncomingNativeTransfer {
    total: usize,
    total_bytes: usize,
    chunks: Vec<Option<Vec<u8>>>,
    received_bytes: usize,
}

#[cfg(test)]
#[derive(Default)]
struct NativeChunkReassembler {
    transfers: HashMap<String, IncomingNativeTransfer>,
    reserved_bytes: usize,
}

#[cfg(test)]
impl NativeChunkReassembler {
    fn push(&mut self, message: &Value) -> Result<Option<Vec<u8>>, String> {
        let transfer_id = message
            .get("transferID")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .ok_or_else(|| "Browser IPC native chunk has an invalid transfer ID".to_string())?;
        let index = usize::try_from(
            message
                .get("index")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Browser IPC native chunk is missing its index".to_string())?,
        )
        .map_err(|_| "Browser IPC native chunk index is out of range".to_string())?;
        let total = usize::try_from(
            message
                .get("total")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Browser IPC native chunk is missing its total".to_string())?,
        )
        .map_err(|_| "Browser IPC native chunk total is out of range".to_string())?;
        let total_bytes = usize::try_from(
            message
                .get("totalBytes")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Browser IPC native chunk is missing its size".to_string())?,
        )
        .map_err(|_| "Browser IPC native chunk size is out of range".to_string())?;
        if total == 0
            || total > MAX_IPC_CHUNKS
            || index >= total
            || total_bytes == 0
            || total_bytes > MAX_NATIVE_MESSAGE_BYTES
        {
            return Err("Browser IPC native chunk metadata is outside its limits".to_string());
        }
        if !self.transfers.contains_key(transfer_id) {
            if self.reserved_bytes.saturating_add(total_bytes) > MAX_NATIVE_MESSAGE_BYTES {
                return Err(
                    "Browser IPC in-flight native messages exceed the 64 MB limit".to_string(),
                );
            }
            self.reserved_bytes += total_bytes;
            self.transfers.insert(
                transfer_id.to_string(),
                IncomingNativeTransfer {
                    total,
                    total_bytes,
                    chunks: vec![None; total],
                    received_bytes: 0,
                },
            );
        }
        let transfer = self
            .transfers
            .get_mut(transfer_id)
            .ok_or_else(|| "Browser IPC native transfer disappeared".to_string())?;
        if transfer.total != total || transfer.total_bytes != total_bytes {
            return Err("Browser IPC native chunk metadata changed during transfer".to_string());
        }
        if transfer.chunks[index].is_some() {
            return Err("Browser IPC native chunk index was received twice".to_string());
        }
        let encoded = message
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| "Browser IPC native chunk is missing its data".to_string())?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "Browser IPC native chunk is not valid base64".to_string())?;
        if bytes.is_empty()
            || bytes.len() > MAX_IPC_CHUNK_BYTES
            || STANDARD.encode(&bytes) != encoded
            || transfer.received_bytes.saturating_add(bytes.len()) > transfer.total_bytes
        {
            return Err("Browser IPC native chunk data is invalid".to_string());
        }
        transfer.received_bytes += bytes.len();
        transfer.chunks[index] = Some(bytes);
        if transfer.chunks.iter().any(Option::is_none) {
            return Ok(None);
        }

        let completed = self
            .transfers
            .remove(transfer_id)
            .ok_or_else(|| "Browser IPC native transfer disappeared".to_string())?;
        self.reserved_bytes = self.reserved_bytes.saturating_sub(completed.total_bytes);
        if completed.received_bytes != completed.total_bytes {
            return Err(
                "Browser IPC native chunks do not match the declared message size".to_string(),
            );
        }
        let mut payload = Vec::with_capacity(completed.total_bytes);
        for chunk in completed.chunks {
            payload
                .extend(chunk.ok_or_else(|| {
                    "Browser IPC native chunk sequence is incomplete".to_string()
                })?);
        }
        Ok(Some(payload))
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[anybox-chrome-native-host] {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let probe_only = env::args_os().skip(1).any(|argument| argument == "--probe");
    let runtime = load_runtime_config()?;
    validate_runtime_config(&runtime)?;
    let bootstrap = load_bootstrap_config(&runtime.bootstrap_path)?;
    validate_bootstrap_config(&runtime, &bootstrap)?;

    let mut stream = connect_local_endpoint(&runtime.native_host_endpoint).map_err(|error| {
        format!("failed to connect to the Anybox Browser IPC endpoint: {error}")
    })?;
    authenticate(&mut stream, &bootstrap)?;
    if probe_only {
        return Ok(());
    }

    let mut browser_host_reader = stream
        .try_clone()
        .map_err(|error| format!("failed to clone the Browser IPC stream: {error}"))?;
    let (input_tx, input_rx) = mpsc::channel();

    let chrome_tx = input_tx.clone();
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_native_message(&mut input) {
                Ok(Some(message)) => {
                    if chrome_tx.send(BridgeInput::ChromeMessage(message)).is_err() {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = chrome_tx.send(BridgeInput::ChromeEnd);
                    return;
                }
                Err(error) => {
                    let _ = chrome_tx.send(BridgeInput::ChromeError(error.to_string()));
                    return;
                }
            }
        }
    });

    thread::spawn(move || {
        loop {
            match read_ipc_json(&mut browser_host_reader) {
                Ok(Some(message)) => {
                    if input_tx
                        .send(BridgeInput::BrowserHostMessage(message))
                        .is_err()
                    {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = input_tx.send(BridgeInput::BrowserHostEnd);
                    return;
                }
                Err(error) => {
                    let _ = input_tx.send(BridgeInput::BrowserHostError(error.to_string()));
                    return;
                }
            }
        }
    });

    let stdout = io::stdout();
    let mut output = stdout.lock();
    while let Ok(input) = input_rx.recv() {
        match input {
            BridgeInput::ChromeMessage(payload) => {
                let message = serde_json::from_slice::<Value>(&payload).map_err(|_| {
                    "Chrome sent a Native Messaging payload that is not valid JSON".to_string()
                })?;
                write_native_payload_to_ipc(&mut stream, &payload, message)
                    .map_err(|error| format!("failed to forward a Chrome message: {error}"))?;
            }
            BridgeInput::ChromeEnd => return Ok(()),
            BridgeInput::ChromeError(error) => {
                return Err(format!(
                    "failed to read a Chrome Native Messaging frame: {error}"
                ));
            }
            BridgeInput::BrowserHostMessage(message) => {
                handle_browser_host_message(&mut stream, &mut output, message)?;
            }
            BridgeInput::BrowserHostEnd => return Ok(()),
            BridgeInput::BrowserHostError(error) => {
                return Err(format!("Anybox Browser IPC connection failed: {error}"));
            }
        }
    }

    Ok(())
}

fn handle_browser_host_message(
    stream: &mut LocalSocketStream,
    output: &mut impl Write,
    message: Value,
) -> Result<(), String> {
    let kind = message
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Anybox Browser IPC message is missing its type".to_string())?;
    match kind {
        "native.message" => {
            let nested = message.get("message").ok_or_else(|| {
                "Anybox Browser IPC native.message is missing its payload".to_string()
            })?;
            let payload = serde_json::to_vec(nested)
                .map_err(|error| format!("failed to encode a Browser Host message: {error}"))?;
            write_native_message(output, &payload)
                .map_err(|error| format!("failed to forward a Browser Host message: {error}"))
        }
        "native.chunk" => {
            // Keep Host -> Extension transfers chunked through Chrome Native
            // Messaging. Reassembling here could exceed Chrome's 1 MiB
            // Native Host output ceiling.
            let payload = serde_json::to_vec(&message)
                .map_err(|error| format!("failed to encode a Browser Host chunk: {error}"))?;
            write_native_message(output, &payload)
                .map_err(|error| format!("failed to forward a Browser Host chunk: {error}"))
        }
        "ping" => {
            let nonce = message
                .get("nonce")
                .and_then(Value::as_str)
                .ok_or_else(|| "Anybox Browser IPC ping is missing its nonce".to_string())?;
            write_ipc_json(stream, &json!({ "type": "pong", "nonce": nonce }))
                .map_err(|error| format!("failed to answer an Anybox Browser IPC ping: {error}"))
        }
        "error" => {
            let code = message
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("UNKNOWN");
            let detail = message
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Anybox Browser IPC returned an error.");
            Err(format!(
                "Anybox Browser IPC rejected the connection ({code}): {detail}"
            ))
        }
        other => Err(format!(
            "Anybox Browser IPC sent unsupported message type '{other}'"
        )),
    }
}

fn write_native_payload_to_ipc<W: Write>(
    stream: &mut W,
    payload: &[u8],
    message: Value,
) -> io::Result<()> {
    if payload.is_empty() || payload.len() > MAX_NATIVE_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "native message size {} is outside 1..={MAX_NATIVE_MESSAGE_BYTES}",
                payload.len()
            ),
        ));
    }
    if payload.len() <= MAX_IPC_CHUNK_BYTES {
        return write_ipc_json(
            stream,
            &json!({
                "type": "native.message",
                "message": message,
            }),
        );
    }

    let total = payload.len().div_ceil(MAX_IPC_CHUNK_BYTES);
    if total > MAX_IPC_CHUNKS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native message needs too many Browser IPC chunks",
        ));
    }
    let transfer_id = format!(
        "native-{}-{}-{}",
        std::process::id(),
        unix_time_millis().unwrap_or_default(),
        TRANSFER_SEQUENCE.fetch_add(1, Ordering::Relaxed),
    );
    for (index, chunk) in payload.chunks(MAX_IPC_CHUNK_BYTES).enumerate() {
        write_ipc_json(
            stream,
            &json!({
                "type": "native.chunk",
                "transferID": transfer_id,
                "index": index,
                "total": total,
                "totalBytes": payload.len(),
                "data": STANDARD.encode(chunk),
            }),
        )?;
    }
    Ok(())
}

fn authenticate(stream: &mut LocalSocketStream, bootstrap: &BootstrapConfig) -> Result<(), String> {
    let challenge_value = read_ipc_json(stream)
        .map_err(|error| format!("failed to read the Anybox Browser IPC challenge: {error}"))?
        .ok_or_else(|| "Anybox Browser IPC closed before sending a challenge".to_string())?;
    let challenge = serde_json::from_value::<ChallengeMessage>(challenge_value)
        .map_err(|error| format!("Anybox Browser IPC challenge is invalid: {error}"))?;

    if challenge.kind != "challenge"
        || challenge.protocol_version != BROWSER_IPC_PROTOCOL_VERSION
        || challenge.role != BROWSER_IPC_ROLE
    {
        return Err("Anybox Browser IPC challenge is incompatible".to_string());
    }
    if challenge.broker_instance_id != bootstrap.broker_instance_id {
        return Err("Anybox Browser IPC broker instance is stale".to_string());
    }
    if challenge.nonce.is_empty() || challenge.expires_at < unix_time_millis()? {
        return Err("Anybox Browser IPC challenge is expired".to_string());
    }

    let client_instance_id = format!("native-host-{}-{}", std::process::id(), unix_time_millis()?);
    let client_version = env!("CARGO_PKG_VERSION");
    let transcript = proof_transcript(
        BROWSER_IPC_ROLE,
        &bootstrap.broker_instance_id,
        &challenge.nonce,
        &client_instance_id,
        client_version,
    );
    let proof = sign_proof(&bootstrap.proof, &transcript)?;
    write_ipc_json(
        stream,
        &json!({
            "type": "hello",
            "protocolVersion": BROWSER_IPC_PROTOCOL_VERSION,
            "role": BROWSER_IPC_ROLE,
            "brokerInstanceID": bootstrap.broker_instance_id,
            "clientInstanceID": client_instance_id,
            "clientVersion": client_version,
            "nonce": challenge.nonce,
            "proof": proof,
            "nativeHostName": NATIVE_HOST_NAME,
            "extensionID": CHROME_EXTENSION_ID,
        }),
    )
    .map_err(|error| format!("failed to send the Anybox Browser IPC hello: {error}"))?;

    let response = read_ipc_json(stream)
        .map_err(|error| format!("failed to read the Anybox Browser IPC hello result: {error}"))?
        .ok_or_else(|| "Anybox Browser IPC closed during authentication".to_string())?;
    match response.get("type").and_then(Value::as_str) {
        Some("ready")
            if response.get("protocolVersion").and_then(Value::as_u64)
                == Some(BROWSER_IPC_PROTOCOL_VERSION as u64)
                && response.get("role").and_then(Value::as_str) == Some(BROWSER_IPC_ROLE)
                && response.get("brokerInstanceID").and_then(Value::as_str)
                    == Some(bootstrap.broker_instance_id.as_str()) =>
        {
            Ok(())
        }
        Some("error") => {
            let code = response
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("UNKNOWN");
            let message = response
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("authentication failed");
            Err(format!(
                "Anybox Browser IPC authentication failed ({code}): {message}"
            ))
        }
        _ => Err("Anybox Browser IPC returned an invalid ready message".to_string()),
    }
}

fn proof_transcript(
    role: &str,
    broker_instance_id: &str,
    nonce: &str,
    client_instance_id: &str,
    client_version: &str,
) -> String {
    [
        format!("anybox-browser-ipc-v{BROWSER_IPC_PROTOCOL_VERSION}"),
        role.to_string(),
        broker_instance_id.to_string(),
        nonce.to_string(),
        client_instance_id.to_string(),
        client_version.to_string(),
    ]
    .join("\n")
}

fn sign_proof(secret: &str, transcript: &str) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| "Anybox Browser IPC bootstrap proof is invalid".to_string())?;
    mac.update(transcript.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

fn unix_time_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch".to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|_| "system time is out of range".to_string())
}

fn validate_runtime_config(config: &RuntimeConfig) -> Result<(), String> {
    let expected_transport = if cfg!(windows) {
        "windows-named-pipe"
    } else {
        "unix-domain-socket"
    };
    if config.transport != expected_transport {
        return Err(format!(
            "Native Host runtime transport '{}' is not supported on this platform",
            config.transport
        ));
    }
    if config.protocol_version != BROWSER_IPC_PROTOCOL_VERSION {
        return Err(format!(
            "Native Host runtime config protocol {} is incompatible with protocol {}",
            config.protocol_version, BROWSER_IPC_PROTOCOL_VERSION
        ));
    }
    if config.native_host_endpoint.trim().is_empty() || config.bootstrap_path.trim().is_empty() {
        return Err("Native Host runtime config is missing its IPC locator".to_string());
    }
    Ok(())
}

fn validate_bootstrap_config(
    runtime: &RuntimeConfig,
    bootstrap: &BootstrapConfig,
) -> Result<(), String> {
    if bootstrap.transport != runtime.transport
        || bootstrap.protocol_version != runtime.protocol_version
        || bootstrap.role != BROWSER_IPC_ROLE
        || bootstrap.endpoint != runtime.native_host_endpoint
        || bootstrap.broker_instance_id.trim().is_empty()
        || bootstrap.proof.trim().is_empty()
    {
        return Err("Native Host bootstrap config is stale or invalid".to_string());
    }
    if bootstrap.expires_at < unix_time_millis()? {
        return Err("Native Host bootstrap config is expired".to_string());
    }
    Ok(())
}

fn load_runtime_config() -> Result<RuntimeConfig, String> {
    for candidate in runtime_config_candidates() {
        let Ok(contents) = fs::read_to_string(&candidate) else {
            continue;
        };
        let config = serde_json::from_str::<RuntimeConfig>(&contents).map_err(|error| {
            format!(
                "Native Host runtime config at {} is invalid: {error}",
                candidate.display()
            )
        })?;
        return Ok(config);
    }
    Err(
        "Native Host runtime config is missing; reinstall or repair the Anybox Chrome plugin"
            .to_string(),
    )
}

fn load_bootstrap_config(path: &str) -> Result<BootstrapConfig, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Native Host bootstrap proof is unavailable: {error}"))?;
    serde_json::from_str::<BootstrapConfig>(&contents)
        .map_err(|error| format!("Native Host bootstrap config is invalid: {error}"))
}

#[cfg(windows)]
fn connect_local_endpoint(endpoint: &str) -> io::Result<LocalSocketStream> {
    let name = endpoint
        .strip_prefix(r"\\.\pipe\")
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Browser IPC endpoint is not a Windows Named Pipe path",
            )
        })?
        .to_ns_name::<GenericNamespaced>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    LocalSocketStream::connect(name)
}

#[cfg(unix)]
fn connect_local_endpoint(endpoint: &str) -> io::Result<LocalSocketStream> {
    let name = endpoint
        .to_fs_name::<GenericFilePath>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    LocalSocketStream::connect(name)
}

#[cfg(not(any(windows, unix)))]
fn connect_local_endpoint(_endpoint: &str) -> io::Result<LocalSocketStream> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Browser IPC is unsupported on this platform",
    ))
}

fn read_ipc_json<R: Read>(reader: &mut R) -> io::Result<Option<Value>> {
    let Some(payload) = read_length_prefixed(reader, false, MAX_IPC_FRAME_BYTES)? else {
        return Ok(None);
    };
    serde_json::from_slice(&payload).map(Some).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Browser IPC frame must contain valid UTF-8 JSON",
        )
    })
}

fn write_ipc_json<W: Write, T: Serialize>(writer: &mut W, value: &T) -> io::Result<()> {
    let payload = serde_json::to_vec(value).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("failed to encode Browser IPC JSON: {error}"),
        )
    })?;
    write_length_prefixed(writer, &payload, false, MAX_IPC_FRAME_BYTES)
}

fn read_native_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    read_length_prefixed(reader, true, MAX_NATIVE_MESSAGE_BYTES)
}

fn write_native_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    write_length_prefixed(writer, payload, true, MAX_NATIVE_OUTPUT_MESSAGE_BYTES)
}

fn read_length_prefixed<R: Read>(
    reader: &mut R,
    little_endian: bool,
    maximum: usize,
) -> io::Result<Option<Vec<u8>>> {
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
                "connection closed inside a frame header",
            ));
        }
        offset += bytes_read;
    }

    let message_length = if little_endian {
        u32::from_le_bytes(header)
    } else {
        u32::from_be_bytes(header)
    } as usize;
    if message_length == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame length must be greater than zero",
        ));
    }
    if message_length > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame is {message_length} bytes; maximum is {maximum}"),
        ));
    }

    let mut payload = vec![0_u8; message_length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_length_prefixed<W: Write>(
    writer: &mut W,
    payload: &[u8],
    little_endian: bool,
    maximum: usize,
) -> io::Result<()> {
    if payload.is_empty() || payload.len() > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame size {} is outside 1..={maximum}", payload.len()),
        ));
    }
    let message_length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame is too large"))?;
    let header = if little_endian {
        message_length.to_le_bytes()
    } else {
        message_length.to_be_bytes()
    };
    writer.write_all(&header)?;
    writer.write_all(payload)?;
    writer.flush()
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
    fn encodes_big_endian_ipc_frames() {
        let value = json!({ "type": "ping", "nonce": "test" });
        let mut output = Vec::new();
        write_ipc_json(&mut output, &value).unwrap();
        let length = u32::from_be_bytes(output[..4].try_into().unwrap()) as usize;
        assert_eq!(length, output.len() - 4);
        assert_eq!(
            serde_json::from_slice::<Value>(&output[4..]).unwrap(),
            value
        );
    }

    #[test]
    fn rejects_zero_and_oversized_ipc_frames() {
        let mut zero = Cursor::new(0_u32.to_be_bytes());
        assert_eq!(
            read_ipc_json(&mut zero).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );

        let mut oversized = Cursor::new(((MAX_IPC_FRAME_BYTES as u32) + 1).to_be_bytes());
        assert_eq!(
            read_ipc_json(&mut oversized).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn rejects_malformed_ipc_json() {
        let payload = b"{invalid";
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(payload);
        let mut cursor = Cursor::new(bytes);
        assert_eq!(
            read_ipc_json(&mut cursor).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn creates_stable_hmac_proofs() {
        let transcript = proof_transcript("native-host", "broker", "nonce", "client", "0.3.0");
        assert_eq!(
            sign_proof("bootstrap-secret", &transcript).unwrap(),
            "3sJp2HmsuZLIEY9WKoujtzdz9GLIcq3_etgnzzaxpFo"
        );
    }

    #[test]
    fn deserializes_secret_free_runtime_config() {
        let config: RuntimeConfig = serde_json::from_str(
            r#"{
                "transport":"windows-named-pipe",
                "protocolVersion":1,
                "runtimeEndpoint":"\\\\.\\pipe\\runtime",
                "nativeHostEndpoint":"\\\\.\\pipe\\native",
                "bootstrapPath":"C:\\bootstrap.json",
                "updatedAt":"2026-07-19T00:00:00.000Z"
            }"#,
        )
        .unwrap();

        assert_eq!(config.protocol_version, BROWSER_IPC_PROTOCOL_VERSION);
        assert_eq!(config.native_host_endpoint, r"\\.\pipe\native");
    }

    #[test]
    fn legacy_runtime_config_cannot_supply_a_transport_token() {
        assert!(
            serde_json::from_str::<RuntimeConfig>(
                r#"{
                    "agentBaseURL":"http://127.0.0.1:4096",
                    "browserTransportToken":"long-lived-secret"
                }"#
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_expired_native_host_bootstrap_config() {
        let transport = if cfg!(windows) {
            "windows-named-pipe"
        } else {
            "unix-domain-socket"
        };
        let runtime = RuntimeConfig {
            transport: transport.to_string(),
            protocol_version: BROWSER_IPC_PROTOCOL_VERSION,
            native_host_endpoint: "test-endpoint".to_string(),
            bootstrap_path: "bootstrap.json".to_string(),
        };
        let bootstrap = BootstrapConfig {
            transport: transport.to_string(),
            protocol_version: BROWSER_IPC_PROTOCOL_VERSION,
            role: BROWSER_IPC_ROLE.to_string(),
            broker_instance_id: "broker".to_string(),
            endpoint: "test-endpoint".to_string(),
            proof: "proof".to_string(),
            expires_at: 1,
        };

        assert_eq!(
            validate_bootstrap_config(&runtime, &bootstrap).unwrap_err(),
            "Native Host bootstrap config is expired"
        );
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
    fn chunks_and_reassembles_native_messages_under_the_64_mb_limit() {
        let message = json!({
            "type": "large",
            "data": "x".repeat(MAX_IPC_CHUNK_BYTES + 1024),
        });
        let payload = serde_json::to_vec(&message).unwrap();
        let mut framed = Vec::new();
        write_native_payload_to_ipc(&mut framed, &payload, message).unwrap();

        let mut cursor = Cursor::new(framed);
        let mut reassembler = NativeChunkReassembler::default();
        let mut reconstructed = None;
        let mut frames = 0;
        while let Some(frame) = read_ipc_json(&mut cursor).unwrap() {
            assert_eq!(
                frame.get("type").and_then(Value::as_str),
                Some("native.chunk")
            );
            reconstructed = reassembler.push(&frame).unwrap().or(reconstructed);
            frames += 1;
        }
        assert!(frames > 1);
        assert_eq!(reconstructed.unwrap(), payload);
    }

    #[test]
    fn rejects_native_chunk_transfers_over_the_total_message_limit() {
        let mut reassembler = NativeChunkReassembler::default();
        let message = json!({
            "type": "native.chunk",
            "transferID": "oversized",
            "index": 0,
            "total": 1,
            "totalBytes": MAX_NATIVE_MESSAGE_BYTES + 1,
            "data": STANDARD.encode(b"x"),
        });
        assert!(
            reassembler
                .push(&message)
                .unwrap_err()
                .contains("outside its limits")
        );
    }

    #[test]
    fn browser_host_chunks_fit_chrome_native_output_limit() {
        let message = json!({
            "type": "native.chunk",
            "transferID": "host-output",
            "index": 0,
            "total": 1,
            "totalBytes": MAX_IPC_CHUNK_BYTES,
            "data": STANDARD.encode(vec![b'x'; MAX_IPC_CHUNK_BYTES]),
        });
        let payload = serde_json::to_vec(&message).unwrap();
        assert!(payload.len() < MAX_NATIVE_OUTPUT_MESSAGE_BYTES);

        let mut framed = Vec::new();
        write_native_message(&mut framed, &payload).unwrap();
        let declared = u32::from_le_bytes(framed[..4].try_into().unwrap()) as usize;
        assert_eq!(declared, payload.len());
    }
}
