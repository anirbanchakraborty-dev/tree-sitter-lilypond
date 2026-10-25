//! Helpers shared by the integration tests.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// One example from `test/corpus/*.txt`.
pub struct CorpusCase {
    /// The corpus file's name, such as `comments.txt`.
    pub file: String,
    /// The example's title.
    pub name: String,
    /// The LilyPond text between the title block and the `---` divider.
    pub input: String,
    /// True when the title block carries `:error`.
    pub expects_error: bool,
    /// True when the input's first line is `% agree: skip, ...`, for an
    /// example LilyPond cannot judge on its own, such as one that includes
    /// a file the corpus does not have.
    pub skip: bool,
}

/// The repository root.
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every example in `test/corpus/*.txt`, in file then document order.
pub fn corpus_cases() -> Vec<CorpusCase> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(root().join("test/corpus"))
        .expect("test/corpus exists")
        .map(|entry| entry.expect("readable corpus folder").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "txt"))
        .collect();
    files.sort();
    files.iter().flat_map(|path| parse_corpus_file(path)).collect()
}

/// Is this line a run of three or more of `c`, such as `===` or `---`?
fn is_rule(line: &str, c: char) -> bool {
    let line = line.trim_end_matches(['\r', '\n']);
    line.len() >= 3 && line.chars().all(|ch| ch == c)
}

fn parse_corpus_file(path: &Path) -> Vec<CorpusCase> {
    let text = std::fs::read_to_string(path).expect("corpus files are UTF-8");
    let file = path.file_name().unwrap().to_string_lossy().into_owned();
    // Keep each line's ending, so that a carriage return inside an example
    // reaches LilyPond exactly as it reaches the parser.
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut cases = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if !is_rule(lines[i], '=') {
            i += 1;
            continue;
        }
        let name = lines.get(i + 1).map_or("", |l| l.trim()).to_string();
        i += 2;
        let mut expects_error = false;
        while i < lines.len() && !is_rule(lines[i], '=') {
            expects_error |= lines[i].trim() == ":error";
            i += 1;
        }
        i += 1;
        let start = i;
        while i < lines.len() && !is_rule(lines[i], '-') && !is_rule(lines[i], '=') {
            i += 1;
        }
        let input = lines[start..i].concat();
        let input = input.trim_matches('\n').to_string();
        let skip = input.starts_with("% agree: skip");
        cases.push(CorpusCase {
            file: file.clone(),
            name,
            input,
            expects_error,
            skip,
        });
        // Step over the expected tree to the next title block.
        while i < lines.len() && !is_rule(lines[i], '=') {
            i += 1;
        }
    }
    cases
}
