//! Every prefix of a file parses to the end. A prefix is what the parser sees
//! while someone types, and a parse that stalls on one stalls the editor.

mod common;

use std::ops::ControlFlow;
use std::time::{Duration, Instant};

use tree_sitter::{ParseOptions, ParseState};

/// How long one prefix may take before the parse is cancelled. A full parse
/// of the whole file takes well under a millisecond.
const LIMIT: Duration = Duration::from_millis(200);

#[test]
fn every_prefix_terminates() {
    let text = std::fs::read_to_string(common::root().join("test/fixtures/everything.ly"))
        .expect("everything.ly exists");
    let mut parser = common::parser();
    let mut stalled = Vec::new();
    let mut parsed = 0;
    for end in (0..=text.len()).filter(|&i| text.is_char_boundary(i)) {
        let prefix = &text.as_bytes()[..end];
        let started = Instant::now();
        let mut cancel = |_: &ParseState| {
            if started.elapsed() > LIMIT {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            }
        };
        let options = ParseOptions::new().progress_callback(&mut cancel);
        let tree = parser.parse_with_options(&mut |i, _| &prefix[i.min(end)..], None, Some(options));
        match tree {
            Some(_) => parsed += 1,
            None => {
                stalled.push(end);
                // A cancelled parse resumes on the next call unless reset.
                parser.reset();
            }
        }
    }
    assert!(parsed > 2000, "only {parsed} prefixes parsed");
    assert!(
        stalled.is_empty(),
        "{} prefixes ran past {LIMIT:?}, ending at bytes {:?}",
        stalled.len(),
        &stalled[..stalled.len().min(20)]
    );
}
