const sign = (code) => ({
    split () {
        return code
        .replaceAll(
            /`{3}[\s\S]*?`{3}|`{2}[\s\S]*?`{2}|`[\s\S]|-?\d{1,3}(,\d{3})*\.?\d*\b|_[\S]*?_|\[[\W_]*?]|\[[^\s,]*?\]+|[\w]+|[[\]{}():;_,]|[!-'*-/:-@\\^`|~]+/g,
            "$& "
        )
        .replaceAll("\n"," ")
        .split(/ +/g)
        .filter(x => x.length);
    }
});