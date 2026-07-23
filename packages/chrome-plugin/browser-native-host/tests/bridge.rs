use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
#[cfg(unix)]
use interprocess::local_socket::GenericFilePath;
#[cfg(windows)]
use interprocess::local_socket::GenericNamespaced;
use interprocess::local_socket::{ListenerOptions, prelude::*};
use serde_json::{Value, json};
use sha2::Sha256;
use std::fs;
use std::io::{self, Read, Write};
#[cfg(unix)]
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const IPC_PROTOCOL_VERSION: u32 = 1;
const IPC_MAX_BYTES: usize = 16 * 1024 * 1024;

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

#[cfg(windows)]
fn endpoint_and_name() -> (String, interprocess::local_socket::Name<'static>) {
    let short = format!("anybox-browser-native-host-test-{}", unique_suffix());
    let name = short
        .clone()
        .to_ns_name::<GenericNamespaced>()
        .unwrap()
        .into_owned();
    (format!(r"\\.\pipe\{short}"), name)
}

#[cfg(unix)]
fn endpoint_and_name() -> (String, interprocess::local_socket::Name<'static>) {
    // macOS limits sockaddr_un.sun_path to 104 bytes. Its per-user temporary
    // directory is already long, so use the stable short /tmp alias there.
    let socket_directory = if cfg!(target_os = "macos") {
        PathBuf::from("/tmp")
    } else {
        std::env::temp_dir()
    };
    let endpoint = socket_directory
        .join(format!("abx-nh-{}.sock", unique_suffix()))
        .to_string_lossy()
        .into_owned();
    let name = endpoint
        .clone()
        .to_fs_name::<GenericFilePath>()
        .unwrap()
        .into_owned();
    (endpoint, name)
}

#[cfg(unix)]
fn remove_endpoint(endpoint: &str) {
    if let Err(error) = fs::remove_file(endpoint)
        && error.kind() != io::ErrorKind::NotFound
    {
        panic!("failed to remove test Unix socket {endpoint}: {error}");
    }
}

#[cfg(windows)]
fn remove_endpoint(_endpoint: &str) {}

fn native_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn read_native_frame(reader: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut header = [0_u8; 4];
    reader.read_exact(&mut header)?;
    let mut payload = vec![0_u8; u32::from_le_bytes(header) as usize];
    reader.read_exact(&mut payload)?;
    Ok(payload)
}

fn write_ipc_json(writer: &mut impl Write, value: &Value) {
    let payload = serde_json::to_vec(value).unwrap();
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .unwrap();
    writer.write_all(&payload).unwrap();
    writer.flush().unwrap();
}

fn read_ipc_json(reader: &mut impl Read) -> Value {
    let mut header = [0_u8; 4];
    reader.read_exact(&mut header).unwrap();
    let length = u32::from_be_bytes(header) as usize;
    assert!((1..=IPC_MAX_BYTES).contains(&length));
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).unwrap();
    serde_json::from_slice(&payload).unwrap()
}

fn proof_for(secret: &str, hello: &Value) -> String {
    let transcript = [
        format!("anybox-browser-ipc-v{IPC_PROTOCOL_VERSION}"),
        "native-host".to_string(),
        hello["brokerInstanceID"].as_str().unwrap().to_string(),
        hello["nonce"].as_str().unwrap().to_string(),
        hello["clientInstanceID"].as_str().unwrap().to_string(),
        hello["clientVersion"].as_str().unwrap().to_string(),
    ]
    .join("\n");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(transcript.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

#[test]
fn forwards_messages_between_chrome_and_the_agent_ipc_gateway() {
    let (endpoint, name) = endpoint_and_name();
    let listener = ListenerOptions::new().name(name).create_sync().unwrap();
    let temp_root =
        std::env::temp_dir().join(format!("anybox-browser-native-host-{}", unique_suffix()));
    fs::create_dir_all(&temp_root).unwrap();
    let runtime_config_path = temp_root.join("runtime.json");
    let bootstrap_path = temp_root.join("bootstrap.json");
    let broker_instance_id = "integration-broker";
    let bootstrap_proof = "integration-bootstrap-proof";
    let transport = if cfg!(windows) {
        "windows-named-pipe"
    } else {
        "unix-domain-socket"
    };
    fs::write(
        &runtime_config_path,
        serde_json::to_vec_pretty(&json!({
            "transport": transport,
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "runtimeEndpoint": "unused",
            "nativeHostEndpoint": endpoint,
            "bootstrapPath": bootstrap_path,
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &bootstrap_path,
        serde_json::to_vec_pretty(&json!({
            "transport": transport,
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "role": "native-host",
            "brokerInstanceID": broker_instance_id,
            "endpoint": endpoint,
            "proof": bootstrap_proof,
            "expiresAt": u64::MAX,
        }))
        .unwrap(),
    )
    .unwrap();

    let server = thread::spawn(move || {
        let mut stream = listener.accept().unwrap();
        let nonce = "integration-challenge-nonce";
        write_ipc_json(
            &mut stream,
            &json!({
                "type": "challenge",
                "protocolVersion": IPC_PROTOCOL_VERSION,
                "role": "native-host",
                "brokerInstanceID": broker_instance_id,
                "nonce": nonce,
                "expiresAt": u64::MAX,
            }),
        );
        let hello = read_ipc_json(&mut stream);
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["role"], "native-host");
        assert_eq!(hello["nativeHostName"], "com.anybox.browser");
        assert_eq!(hello["extensionID"], "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc");
        assert_eq!(
            hello["proof"].as_str().unwrap(),
            proof_for(bootstrap_proof, &hello)
        );
        write_ipc_json(
            &mut stream,
            &json!({
                "type": "ready",
                "protocolVersion": IPC_PROTOCOL_VERSION,
                "role": "native-host",
                "brokerInstanceID": broker_instance_id,
            }),
        );
        write_ipc_json(
            &mut stream,
            &json!({
                "type": "native.message",
                "message": {
                    "type": "command",
                    "commandID": "1",
                },
            }),
        );
        let from_chrome = read_ipc_json(&mut stream);
        assert_eq!(
            from_chrome,
            json!({
                "type": "native.message",
                "message": {
                    "type": "hello",
                    "extensionID": "test",
                },
            })
        );
    });

    let mut child = Command::new(env!("CARGO_BIN_EXE_extension-host"))
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
    let from_agent = match read_native_frame(child.stdout.as_mut().unwrap()) {
        Ok(message) => message,
        Err(error) => {
            drop(child.stdin.take());
            let status = child.wait().unwrap();
            let mut stderr = String::new();
            child
                .stderr
                .as_mut()
                .unwrap()
                .read_to_string(&mut stderr)
                .unwrap();
            panic!(
                "failed to read Native Messaging output ({error}); extension-host exited with {status}: {stderr}"
            );
        }
    };
    assert_eq!(
        from_agent,
        br#"{"commandID":"1","type":"command"}"#.to_vec()
    );

    drop(child.stdin.take());
    server.join().unwrap();
    let status = child.wait().unwrap();
    remove_endpoint(&endpoint);
    fs::remove_dir_all(temp_root).unwrap();
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

#[test]
fn probe_authenticates_with_the_browser_host_and_exits() {
    let (endpoint, name) = endpoint_and_name();
    let listener = ListenerOptions::new().name(name).create_sync().unwrap();
    let temp_root = std::env::temp_dir().join(format!(
        "anybox-browser-native-host-probe-{}",
        unique_suffix()
    ));
    fs::create_dir_all(&temp_root).unwrap();
    let runtime_config_path = temp_root.join("runtime.json");
    let bootstrap_path = temp_root.join("bootstrap.json");
    let broker_instance_id = "probe-integration-broker";
    let bootstrap_proof = "probe-integration-bootstrap-proof";
    let transport = if cfg!(windows) {
        "windows-named-pipe"
    } else {
        "unix-domain-socket"
    };
    fs::write(
        &runtime_config_path,
        serde_json::to_vec_pretty(&json!({
            "transport": transport,
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "runtimeEndpoint": "unused",
            "nativeHostEndpoint": endpoint,
            "bootstrapPath": bootstrap_path,
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &bootstrap_path,
        serde_json::to_vec_pretty(&json!({
            "transport": transport,
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "role": "native-host",
            "brokerInstanceID": broker_instance_id,
            "endpoint": endpoint,
            "proof": bootstrap_proof,
            "expiresAt": u64::MAX,
        }))
        .unwrap(),
    )
    .unwrap();

    let server = thread::spawn(move || {
        let mut stream = listener.accept().unwrap();
        write_ipc_json(
            &mut stream,
            &json!({
                "type": "challenge",
                "protocolVersion": IPC_PROTOCOL_VERSION,
                "role": "native-host",
                "brokerInstanceID": broker_instance_id,
                "nonce": "probe-challenge-nonce",
                "expiresAt": u64::MAX,
            }),
        );
        let hello = read_ipc_json(&mut stream);
        assert_eq!(hello["type"], "hello");
        assert_eq!(
            hello["proof"].as_str().unwrap(),
            proof_for(bootstrap_proof, &hello)
        );
        write_ipc_json(
            &mut stream,
            &json!({
                "type": "ready",
                "protocolVersion": IPC_PROTOCOL_VERSION,
                "role": "native-host",
                "brokerInstanceID": broker_instance_id,
            }),
        );
        let mut trailing = [0_u8; 1];
        assert_eq!(stream.read(&mut trailing).unwrap(), 0);
    });

    let output = Command::new(env!("CARGO_BIN_EXE_extension-host"))
        .arg("--probe")
        .env("ANYBOX_BROWSER_NATIVE_CONFIG", &runtime_config_path)
        .output()
        .unwrap();

    server.join().unwrap();
    remove_endpoint(&endpoint);
    fs::remove_dir_all(temp_root).unwrap();
    assert!(
        output.status.success(),
        "extension-host probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
}
