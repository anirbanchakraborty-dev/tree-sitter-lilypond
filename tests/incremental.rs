//! Reparsing after an edit, reusing the old tree, gives the same tree as
//! parsing the edited text from nothing. The scanner keeps one byte of state,
//! how deeply `#{ ... #}` nests, and a byte serialised or restored wrongly
//! shows up here as a tree that differs.

mod common;

use tree_sitter::{Node, Tree};

/// How many places in each file are edited.
const POSITIONS: usize = 500;

/// The one character inserted at each place, taken in turn, so that the
/// edits include ones that close a block, start a command, a comment or
/// Scheme, or split a line.
const SINGLES: [&str; 8] = ["x", " ", "\n", "}", "\\", "'", "#", "%"];

/// The openers inserted at every place. Each one changes how the rest of the
/// file reads until something closes it.
const OPENERS: [&str; 5] = ["{", "\"", "%{", "#{", "#("];

/// Node kinds the edited places must fall inside at least once.
const INSIDE: [&str; 5] = [
    "string",
    "line_comment",
    "block_comment",
    "scheme",
    "embedded_lilypond",
];

const FILES: [&str; 2] = ["song-100.ly", "everything.ly"];

fn fixture(name: &str) -> String {
    std::fs::read_to_string(common::root().join("test/fixtures").join(name))
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// `POSITIONS` byte offsets spread evenly from the start of `text` to its
/// end, each moved forward to the next character boundary.
fn positions(text: &str) -> Vec<usize> {
    let mut out: Vec<usize> = (0..POSITIONS)
        .map(|i| {
            let mut at = i * text.len() / (POSITIONS - 1);
            while !text.is_char_boundary(at) {
                at += 1;
            }
            at
        })
        .collect();
    out.dedup();
    out
}

/// The kind and byte range of every node in `tree`.
fn spans(tree: &Tree) -> Vec<(&str, usize, usize)> {
    fn walk<'t>(node: Node<'t>, out: &mut Vec<(&'t str, usize, usize)>) {
        out.push((node.kind(), node.start_byte(), node.end_byte()));
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree.root_node(), &mut out);
    out
}

/// The first line on which two dumps differ, for the failure message.
fn first_difference(incremental: &str, fresh: &str) -> String {
    let pairs = incremental.lines().zip(fresh.lines()).enumerate();
    for (line, (a, b)) in pairs {
        if a != b {
            return format!("line {}: incremental {a:?}, fresh {b:?}", line + 1);
        }
    }
    "one dump is a prefix of the other".to_string()
}

#[test]
fn edited_places_cover_strings_comments_and_scheme() {
    let text = fixture("everything.ly");
    let tree = common::parser().parse(&text, None).unwrap();
    let spans = spans(&tree);
    let places = positions(&text);
    for kind in INSIDE {
        let hit = spans.iter().any(|&(k, start, end)| {
            k == kind && places.iter().any(|&at| start < at && at < end)
        });
        assert!(hit, "no edited place falls inside a `{kind}`");
    }
}

/// Every edit made at one place: one character inserted, the character there
/// deleted, and each opener inserted.
fn edits_at(text: &str, i: usize, at: usize) -> Vec<(usize, &'static str)> {
    let mut edits = vec![(0, SINGLES[i % SINGLES.len()])];
    if let Some(c) = text[at..].chars().next() {
        edits.push((c.len_utf8(), ""));
    }
    edits.extend(OPENERS.iter().map(|opener| (0, *opener)));
    edits
}

#[test]
fn incremental_matches_fresh() {
    let texts: Vec<(&str, String)> = FILES.iter().map(|name| (*name, fixture(name))).collect();
    let mut jobs = Vec::new();
    for (name, text) in &texts {
        for (i, at) in positions(text).into_iter().enumerate() {
            for (delete, insert) in edits_at(text, i, at) {
                jobs.push((*name, text.as_str(), at, delete, insert));
            }
        }
    }
    // A debug build reparses slowly, so the edits are shared across threads.
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let mut failures: Vec<String> = std::thread::scope(|scope| {
        let workers: Vec<_> = jobs
            .chunks(jobs.len().div_ceil(threads))
            .map(|chunk| {
                scope.spawn(move || {
                    let mut failures = Vec::new();
                    for &(name, text, at, delete, insert) in chunk {
                        let (incremental, fresh) = common::edit_and_reparse(text, at, delete, insert);
                        if incremental != fresh {
                            failures.push(format!(
                                "{name} at byte {at}, delete {delete}, insert {insert:?}: {}",
                                first_difference(&incremental, &fresh)
                            ));
                        }
                    }
                    failures
                })
            })
            .collect();
        workers.into_iter().flat_map(|w| w.join().unwrap()).collect()
    });
    failures.sort();
    let edits = jobs.len();
    assert!(edits > 6000, "only {edits} edits made");
    assert!(
        failures.is_empty(),
        "{} of {edits} edits reparse differently, first ten:\n{}",
        failures.len(),
        failures[..failures.len().min(10)].join("\n")
    );
}
