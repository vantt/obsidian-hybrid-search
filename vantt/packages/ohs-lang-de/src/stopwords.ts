/** Folded German function words dropped from view queries when other words remain. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'der die das den dem des ein eine einen einem einer eines und oder aber nicht ist sind war ' +
    'wie was wer wo wann wird werden wurde im in am an auf aus bei mit nach von vom zu zum zur ' +
    'fur uber unter vor auch es sich ich du er sie wir ihr als dass'
  ).split(' '),
);
