//! Every corpus example must be valid LilyPond, or, when marked `:error`,
//! invalid LilyPond. This keeps every syntax fact the grammar encodes
//! checked against the compiler rather than taken from memory.

mod common;

use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

const TESTED_VERSION: &str = "2.26.0";

/// The installed LilyPond's version line, or why there is none.
fn lilypond_version() -> Result<String, String> {
    let output = Command::new("lilypond")
        .arg("--version")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| format!("lilypond could not be run: {e}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.lines().next().unwrap_or("").to_string())
}

/// Run LilyPond on one example in its own folder and return whether it
/// accepted the file, with its stderr.
fn judge(input: &str, folder: &Path) -> (bool, String) {
    std::fs::create_dir_all(folder).expect("temporary folder");
    let file = folder.join("case.ly");
    std::fs::write(&file, input).expect("write the example");
    let output = Command::new("lilypond")
        .env("LC_ALL", "C")
        .current_dir(folder)
        .arg("-l")
        .arg("WARNING")
        .arg("-dno-print-pages")
        .arg("-o")
        .arg(folder.join("out"))
        .arg(&file)
        .output()
        .expect("lilypond runs");
    let _ = std::fs::remove_dir_all(folder);
    (
        output.status.success(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[test]
fn lilypond_agrees_with_every_example() {
    match lilypond_version() {
        Ok(line) if line.contains(TESTED_VERSION) => {}
        Ok(line) => {
            println!("skipped: LilyPond {TESTED_VERSION} is the tested version, found {line:?}");
            return;
        }
        Err(e) => {
            println!("skipped: {e}");
            return;
        }
    }
    let cases: Vec<_> = common::corpus_cases()
        .into_iter()
        .filter(|case| !case.skip)
        .collect();
    assert!(!cases.is_empty(), "no corpus examples found");
    let scratch = std::env::temp_dir().join(format!("tree-sitter-lilypond-agree-{}", std::process::id()));
    let next = AtomicUsize::new(0);
    let failures = Mutex::new(Vec::new());
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(case) = cases.get(i) else { break };
                    let (accepted, stderr) = judge(&case.input, &scratch.join(i.to_string()));
                    if accepted == case.expects_error {
                        let verdict = if accepted { "accepted" } else { "rejected" };
                        failures.lock().unwrap().push(format!(
                            "{} / {}: LilyPond {verdict} it, but the example is {}\n{stderr}",
                            case.file,
                            case.name,
                            if case.expects_error { "marked :error" } else { "not marked :error" },
                        ));
                    }
                }
            });
        }
    });
    let _ = std::fs::remove_dir_all(&scratch);
    let failures = failures.into_inner().unwrap();
    assert!(
        failures.is_empty(),
        "{} of {} examples disagree with LilyPond:\n\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}
