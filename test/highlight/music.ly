\version "2.26.0"
% <- keyword.import
%        ^ string

melody = \relative c' {
% <- variable.member
%      ^ operator
%        ^ function.call
%                  ^ variable
%                   ^ operator
%                     ^ punctuation.bracket
  c4-. d8( e) f16[ g] a4~ a |
% ^ variable
%  ^ number
%   ^ attribute
%        ^ punctuation.special
%           ^ punctuation.special
%                ^ punctuation.special
%                   ^ punctuation.special
%                       ^ punctuation.special
%                           ^ punctuation.delimiter
  cis!4 d?8 e,='4 r4 s4 R1 |
%    ^ operator
%        ^ operator
%            ^ operator
%             ^ operator
%                 ^ constant.builtin
%                    ^ constant.builtin
%                       ^ constant.builtin
%                        ^ number
  <c e g>2 q4 c4\ff d\< e\! f\> g\! |
% ^ punctuation.bracket
%       ^ punctuation.bracket
%          ^ constant.builtin
%               ^ attribute.builtin
%                    ^ attribute.builtin
%                        ^ attribute.builtin
%                            ^ attribute.builtin
  g4-1 a\2 b:16 c^"dolce" c-\fermata d-\p |
%   ^ attribute
%    ^ attribute
%       ^ attribute
%           ^ attribute
%                ^ string
%                 ^ string
%                          ^ attribute
%                           ^ attribute
%                                     ^ attribute
%                                      ^ attribute.builtin
  c\( d\) c\[ d\] c\breve |
%  ^ punctuation.special
%      ^ punctuation.special
%          ^ punctuation.special
%              ^ punctuation.special
%                  ^ number
  << { c4 } \\ { e4 } >>
% ^ punctuation.bracket
%           ^ punctuation.delimiter
%                     ^ punctuation.bracket
  \time 3/4 c2.*2/3
% ^ function.call
%       ^ number
%             ^ number
%              ^ number
}
% <- punctuation.bracket

harmonies = \chordmode { c1:m7 d:7/fis e/+g }
%           ^ keyword
%                        ^ variable
%                         ^ number
%                           ^ type
%                                  ^ variable
%                                         ^ variable
bass = \figuremode { <6 4>4 <7+ 5->2 }
%      ^ keyword
%                    ^ punctuation.bracket
%                     ^ number
%                             ^ number
drumming = \drummode { bd4 sn hh8 hh }
%          ^ keyword
%                      ^ variable

\score {
% <- keyword
  \new Staff = "up" \with { \consists "Ambitus_engraver" } {
% ^ keyword
%      ^ type
%            ^ operator
%              ^ string
%                   ^ keyword
%                           ^ keyword
    \override Staff.TimeSignature.color = #red
%   ^ keyword
%             ^ property
%                                       ^ operator
%                                         ^ punctuation.special
%                                          ^ variable
    \set Staff.instrumentName = "Flute"
%   ^ keyword
%        ^ property
    \revert Staff.TimeSignature.color
%   ^ keyword
    \unset Staff.instrumentName
%   ^ keyword
    \tempo "Allegro" 4 = 120
%   ^ keyword
%          ^ string
%                    ^ number
%                        ^ number
    \repeat volta 2 { c'1 }
%   ^ keyword
%                 ^ number
    \alternative { { d'1 } { e'1 } }
%   ^ keyword
    \change Staff = "up"
%   ^ keyword
%           ^ type
    \melody
%   ^ function.call
  }
}
