\version "2.26.0"
\include "english.ly"
\language "english"

% Every construct the grammar knows, in one file, for the incremental,
% prefix and speed tests.
%{ A block comment
   over two lines. %}

\header {
  title = "Everything"
  subtitle = \markup \italic { for "the tests" }
  tagline = ##f
}

\paper { indent = 0 #(set-paper-size "a4") }

size = #(+ 1 2.5 -3/4)
label = #"tab\there \"quoted\""
flags = #'(#t #f #\a #:key)
quasi = #`(1 ,size ,@(list 2 3))
vec = #(vector 1 #(2 3) "s")
dollar = $(list 'a 'b)
blocky = #(begin ; a line comment
  #| a block #| nested |# comment |#
  #;(ignored datum) 7)
"spaced name" = { c'1 }
verse.1 = \lyricmode { one two }

inner = #(define-music-function (n) (number?)
  #{ c'4 #(if (> n 1) #{ d'4 #} #{ e'4 #}) #})

melody = \relative c'' {
  \time 3/4 \key g \major \tempo "Allegro" 4 = 120
  c8~ c d16( e) f[ g] a4-. |
  cs!4 d?8 e,=''8 r4 | s2. | R2.*2 |
  <c e g>2 q4 | c4\ff d\< e\! | f\> g\! a |
  g4-1 a\2 b:16 | c^"dolce" c_\markup { \bold x } c-\fermata |
  c\( d\) c | c\[ d\] c | c2.*2/3 c4 |
  << { c4 d e } \\ { e4 f g } >> |
  \repeat volta 2 { c4 d e } \alternative { { f2. } { g2. } }
  \inner 2 \verse.1 \"spaced name"
  \override Staff.TimeSignature.color = #red
  \set Staff.instrumentName = "Flute"
  \revert Staff.TimeSignature.color
  \unset Staff.instrumentName
  \once \override NoteHead.style = #'cross
  \simultaneous { c4 e } \sequential { d4 f }
}

harmonies = \chordmode { c1:m7 d:7/fs e/+g f:maj9^3 g4 8 }
bass = \figuremode { <6 4>4 <7+ 5->2 <6 [4 3]>4 <_+>2 }
drumming = \drummode { bd4 sn8 hh hh4 r }
plain = \notemode { c4 d e f }
words = \lyricmode { Hel -- lo __ world, _ "quoted" }

\score {
  <<
    \new ChordNames \harmonies
    \new Staff = "up" \with { \consists "Ambitus_engraver" } {
      \new Voice = "lead" { \melody }
    }
    \new Lyrics \lyricsto "lead" { \words }
    \new FiguredBass \bass
    \new DrumStaff \drumming
    \chords \with { } { c1 }
    \drums { bd4 sn }
    \figures { <6>4 }
    \lyrics { la la }
    { c'4 d' } \addlyrics { do re }
    \new Staff { c'4 \change Staff = "up" d'4 }
  >>
  \layout {
    \context {
      \Staff
      \remove "Time_signature_engraver"
      \consists "Span_arpeggio_engraver"
      \accepts "CueVoice"
      \defaultchild "Voice"
      \name "Staff"
      \alias "Staff"
      \override BarLine.thickness = 2
    }
    \context { \Voice \denies "Thing" }
  }
  \midi { \tempo 4 = 90 }
}

\book {
  \bookpart {
    \header { piece = \markuplist { one two } }
    \score { { c'1 c'\breve c'\longa } \layout { } }
  }
}
