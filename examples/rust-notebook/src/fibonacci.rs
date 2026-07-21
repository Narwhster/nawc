// A self-contained script runnable with `rust-script`. It is not part of the
// cargo library, so it has its own `fn main`.
fn fib(n: u64) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => fib(n - 1) + fib(n - 2),
    }
}

fn demo() {
    for n in 0..10 {
        println!("fib({n}) = {}", fib(n));
    }
}

fn main() {
    demo();
}
