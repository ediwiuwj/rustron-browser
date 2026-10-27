fn main() {
    println!(
        "Rustron {} — motor: {}",
        env!("CARGO_PKG_VERSION"),
        rustron_engine::ENGINE_NAME
    );
}
