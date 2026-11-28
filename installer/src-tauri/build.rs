fn main() {
    let payload = std::env::var_os("MOKI_INSTALLER_PAYLOAD")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("../payload/setup.exe"));
    println!("cargo:rerun-if-env-changed=MOKI_INSTALLER_PAYLOAD");
    println!("cargo:rerun-if-changed={}", payload.display());
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("payload.exe");
    if payload.exists() {
        std::fs::copy(&payload, &output).expect("Could not embed installer payload");
    } else if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("Missing NSIS payload. Build with npm run installer:bundle");
    } else {
        std::fs::write(output, []).unwrap();
    }
    println!("cargo:rerun-if-changed=../../src-tauri/windows/as-invoker.manifest");
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("../../src-tauri/windows/as-invoker.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("Could not build MokiDown Setup resources");
}
