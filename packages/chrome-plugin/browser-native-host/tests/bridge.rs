use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tungstenite::handshake::server::{Request, Response};
use tungstenite::{Message, accept_hdr};

fn native_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn read_native_frame(reader: &mut impl Read) -> Vec<u8> {
    let mut header = [0_u8; 4];
    reader.read_exact(&mut header).unwrap();
    let mut payload = vec![0_u8; u32::from_le_bytes(header) as usize];
    reader.read_exact(&mut payload).unwrap();
    payload
}

#[test]
fn forwards_messages_between_chrome_and_the_agent_websocket() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let runtime_config_path = std::env::temp_dir().join(format!(
        "anybox-browser-native-host-{}-{}.json",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(
        &runtime_config_path,
        format!(
            r#"{{"agentBaseURL":"http://127.0.0.1:{port}","browserTransportToken":"transport-secret"}}"#
        ),
    )
    .unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut websocket = accept_hdr(stream, |request: &Request, response: Response| {
            assert_eq!(
                request.headers().get("authorization").unwrap(),
                "Bearer transport-secret"
            );
            Ok(response)
        })
        .unwrap();
        websocket
            .send(Message::Text(
                r#"{"type":"command","commandID":"1"}"#.into(),
            ))
            .unwrap();
        let from_chrome = websocket.read().unwrap();
        assert_eq!(
            from_chrome.into_text().unwrap(),
            r#"{"type":"hello","extensionID":"test"}"#
        );
        websocket.close(None).unwrap();
    });

    let mut child = Command::new(env!("CARGO_BIN_EXE_extension-host"))
        .env_remove("ANYBOX_AGENT_BASE_URL")
        .env_remove("ANYBOX_BROWSER_TRANSPORT_TOKEN")
        .env("ANYBOX_BROWSER_NATIVE_CONFIG", &runtime_config_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&native_frame(br#"{"type":"hello","extensionID":"test"}"#))
        .unwrap();
    let from_agent = read_native_frame(child.stdout.as_mut().unwrap());
    assert_eq!(
        from_agent,
        br#"{"type":"command","commandID":"1"}"#.to_vec()
    );

    drop(child.stdin.take());
    server.join().unwrap();
    let status = child.wait().unwrap();
    fs::remove_file(runtime_config_path).unwrap();
    if !status.success() {
        let mut stderr = String::new();
        child
            .stderr
            .as_mut()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        panic!("extension-host exited with {status}: {stderr}");
    }
}
