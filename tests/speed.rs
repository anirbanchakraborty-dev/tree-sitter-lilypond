//! The design's speed targets. Timing a debug build says nothing, so this
//! runs only on request, in release:
//!
//! `cargo test --release --test speed -- --include-ignored --nocapture`

mod common;

use std::time::{Duration, Instant};

use tree_sitter::{Parser, Tree};

/// Timed runs per measurement, after the warm-up runs.
const RUNS: usize = 20;
const WARM_UP: usize = 3;

/// How many times the 10,000-bar file repeats the song's 100 bars.
const REPEATS: usize = 100;

/// The median of `RUNS` timings of `run`, after `WARM_UP` untimed calls.
/// `run` returns the time of the part it measures, so that setup such as
/// cloning a tree stays outside the timing.
fn median(mut run: impl FnMut() -> Duration) -> Duration {
    for _ in 0..WARM_UP {
        run();
    }
    let mut times: Vec<Duration> = (0..RUNS).map(|_| run()).collect();
    times.sort();
    times[RUNS / 2]
}

fn full_parse(parser: &mut Parser, text: &str) -> Duration {
    median(|| {
        let started = Instant::now();
        let tree = parser.parse(text, None).expect("parses");
        let took = started.elapsed();
        assert!(!tree.root_node().has_error());
        took
    })
}

/// The byte just after the first `'` in the middle bar line of `text`, where
/// typing another `'` raises that bar's first note by an octave.
fn middle_note(text: &str) -> usize {
    let mut bars = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        if line.trim_end().ends_with('|') {
            bars.push((offset, line));
        }
        offset += line.len();
    }
    let (start, line) = bars[bars.len() / 2];
    start + line.find('\'').expect("the bar has an octave mark") + 1
}

/// The median time to reparse `text` after typing one `'` into its middle
/// bar, turning a `c'8` into `c''8`, with the old tree reused.
fn one_character_reparse(parser: &mut Parser, text: &str, tree: &Tree) -> Duration {
    let (edited, edit) = common::edit_for(text, middle_note(text), 0, "'");
    median(|| {
        let mut old = tree.clone();
        old.edit(&edit);
        let started = Instant::now();
        let tree = parser.parse(&edited, Some(&old)).expect("reparses");
        let took = started.elapsed();
        assert!(!tree.root_node().has_error());
        took
    })
}

/// The song with its 100 bar lines repeated `REPEATS` times.
fn long_song(song: &str) -> String {
    let lines: Vec<&str> = song.split_inclusive('\n').collect();
    let is_bar = |line: &&str| line.trim_end().ends_with('|');
    let first = lines.iter().position(is_bar).expect("bar lines");
    let last = lines.iter().rposition(is_bar).expect("bar lines");
    assert!(lines[first..=last].iter().all(is_bar), "the bar lines are not contiguous");
    let bars = lines[first..=last].concat();
    let mut out = lines[..first].concat();
    for _ in 0..REPEATS {
        out.push_str(&bars);
    }
    out.push_str(&lines[last + 1..].concat());
    out
}

#[test]
#[ignore = "timing, run in release with --include-ignored"]
fn speed_targets() {
    let song = std::fs::read_to_string(common::root().join("test/fixtures/song-100.ly"))
        .expect("song-100.ly exists");
    let long = long_song(&song);
    let mut parser = common::parser();

    let song_full = full_parse(&mut parser, &song);
    let song_tree = parser.parse(&song, None).unwrap();
    let song_edit = one_character_reparse(&mut parser, &song, &song_tree);
    let long_full = full_parse(&mut parser, &long);
    let long_tree = parser.parse(&long, None).unwrap();
    let long_edit = one_character_reparse(&mut parser, &long, &long_tree);

    println!("100 bars, {} bytes: full parse {song_full:?}, one-character reparse {song_edit:?}", song.len());
    println!("10,000 bars, {} bytes: full parse {long_full:?}, one-character reparse {long_edit:?}", long.len());
    println!("scaling: {:.1} times the 100-bar full parse", long_full.as_secs_f64() / song_full.as_secs_f64());

    assert!(song_full <= Duration::from_millis(5), "100-bar full parse {song_full:?}");
    assert!(song_edit <= Duration::from_millis(1), "100-bar reparse {song_edit:?}");
    assert!(long_full <= song_full * 110, "10,000-bar full parse {long_full:?} against {song_full:?}");
    assert!(long_edit <= Duration::from_millis(2), "10,000-bar reparse {long_edit:?}");
}
