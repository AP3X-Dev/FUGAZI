def issuesArr: (.issues // []);

"## Auto-fixable issues\n\n" +
(if ([issuesArr[] | select(.fixable == true)] | length) == 0 then
  "No auto-fixable issues."
else
  "Run `fugazi fix` to apply these:\n\n" +
  "| Rule | File | Line |\n| --- | --- | --- |\n" +
  (issuesArr
    | map(select(.fixable == true))
    | .[0:50]
    | map("| `\(.ruleId)` | `\(.file)` | \(.startLine // .line // 1) |")
    | join("\n"))
end)
