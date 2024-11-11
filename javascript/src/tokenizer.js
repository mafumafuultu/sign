const {
  remove,
  lift,
  normalizeCompares,
  dictionaryStart,
  dictionaryContent,
  matchCaseContent,
  pattern
} = requier('./tool.js')

module.exports = function processTokens(line) {
  return matchCaseContent(
    dictionaryContent(
      dictionaryStart(
        normalizeCompares(
          lift(
            pattern.letter,
            remove(
              pattern.comment,
              line
            )
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.string) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.number) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.hex) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.oct) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.bit) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.identifier) : o
          )
          .map(
            o => typeof o === 'string' ? lift(pattern.unit) : o
          )
        )
      )
    )
  );
}
