use keyring::{Entry, Error as KeyringError};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, Read};

const SERVICE: &str = "com.anybox.cinema";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct Response {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ResponseError>,
}

#[derive(Serialize)]
struct ResponseError {
    code: &'static str,
    message: String,
}

#[derive(Deserialize)]
struct CredentialParams {
    service: String,
    account: String,
    #[serde(default)]
    value: Option<String>,
}

#[derive(Deserialize)]
struct PickFileParams {
    #[serde(default)]
    filters: Vec<FileFilter>,
}

#[derive(Deserialize)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

fn invalid_params(message: impl Into<String>) -> ResponseError {
    ResponseError {
        code: "INVALID_PARAMS",
        message: message.into(),
    }
}

fn keychain_error(_error: KeyringError) -> ResponseError {
    ResponseError {
        code: "KEYCHAIN_UNAVAILABLE",
        message: "The operating-system credential store is unavailable.".to_string(),
    }
}

fn credential_entry(params: &CredentialParams) -> Result<Entry, ResponseError> {
    if params.service != SERVICE {
        return Err(invalid_params(
            "The credential service is fixed by the Cinema runtime.",
        ));
    }
    let account = params.account.trim();
    if account.is_empty() || account.len() > 256 {
        return Err(invalid_params("A valid credential account is required."));
    }
    Entry::new(SERVICE, account).map_err(keychain_error)
}

fn credential_get(params: CredentialParams) -> Result<Value, ResponseError> {
    match credential_entry(&params)?.get_password() {
        Ok(value) => Ok(json!({ "value": value })),
        Err(KeyringError::NoEntry) => Ok(json!({ "value": null })),
        Err(error) => Err(keychain_error(error)),
    }
}

fn credential_set(params: CredentialParams) -> Result<Value, ResponseError> {
    let value = params
        .value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_params("A non-empty credential value is required."))?;
    credential_entry(&params)?
        .set_password(value)
        .map_err(keychain_error)?;
    Ok(json!({ "configured": true }))
}

fn credential_delete(params: CredentialParams) -> Result<Value, ResponseError> {
    match credential_entry(&params)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(json!({ "configured": false })),
        Err(error) => Err(keychain_error(error)),
    }
}

fn pick_directory() -> Value {
    let path = FileDialog::new()
        .set_title("Open Cinema project")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned());
    json!({ "path": path })
}

fn pick_file(params: PickFileParams) -> Value {
    let mut dialog = FileDialog::new().set_title("Select Cinema toolchain archive");
    for filter in params.filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    let path = dialog
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned());
    json!({ "path": path })
}

fn dispatch(request: &Request) -> Result<Value, ResponseError> {
    match request.method.as_str() {
        "credential.get" => serde_json::from_value(request.params.clone())
            .map_err(|error| invalid_params(error.to_string()))
            .and_then(credential_get),
        "credential.set" => serde_json::from_value(request.params.clone())
            .map_err(|error| invalid_params(error.to_string()))
            .and_then(credential_set),
        "credential.delete" => serde_json::from_value(request.params.clone())
            .map_err(|error| invalid_params(error.to_string()))
            .and_then(credential_delete),
        "dialog.pickDirectory" => Ok(pick_directory()),
        "dialog.pickFile" => serde_json::from_value(request.params.clone())
            .map_err(|error| invalid_params(error.to_string()))
            .map(pick_file),
        _ => Err(ResponseError {
            code: "METHOD_NOT_FOUND",
            message: format!("Unknown helper method '{}'.", request.method),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, params: Value) -> Request {
        Request {
            id: "test".to_string(),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn rejects_unknown_methods() {
        let error = dispatch(&request("system.shell", json!({}))).unwrap_err();
        assert_eq!(error.code, "METHOD_NOT_FOUND");
    }

    #[test]
    fn enforces_the_fixed_credential_service_before_touching_the_keychain() {
        let error = dispatch(&request(
            "credential.get",
            json!({ "service": "com.example.other", "account": "provider.test.api-key" }),
        ))
        .unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
    }

    #[test]
    fn rejects_empty_secret_values_without_echoing_them() {
        let error = dispatch(&request(
            "credential.set",
            json!({ "service": SERVICE, "account": "provider.test.api-key", "value": "  " }),
        ))
        .unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
        assert!(!error.message.contains("provider.test.api-key"));
    }

    #[test]
    fn keychain_errors_are_redacted() {
        let error = keychain_error(KeyringError::NoEntry);
        assert_eq!(error.code, "KEYCHAIN_UNAVAILABLE");
        assert_eq!(
            error.message,
            "The operating-system credential store is unavailable."
        );
    }
}

fn main() {
    let mut input = String::new();
    let read_result = io::stdin().read_to_string(&mut input);
    let request = read_result
        .map_err(|error| error.to_string())
        .and_then(|_| {
            serde_json::from_str::<Request>(input.trim()).map_err(|error| error.to_string())
        });

    let response = match request {
        Ok(request) => match dispatch(&request) {
            Ok(result) => Response {
                id: request.id,
                result: Some(result),
                error: None,
            },
            Err(error) => Response {
                id: request.id,
                result: None,
                error: Some(error),
            },
        },
        Err(message) => Response {
            id: "invalid".to_string(),
            result: None,
            error: Some(ResponseError {
                code: "INVALID_REQUEST",
                message,
            }),
        },
    };

    match serde_json::to_string(&response) {
        Ok(output) => println!("{output}"),
        Err(_) => println!(
            "{}",
            r#"{"id":"invalid","error":{"code":"INTERNAL_ERROR","message":"Unable to serialize helper response."}}"#
        ),
    }
}
