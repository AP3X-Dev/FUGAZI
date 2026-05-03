def issuesArr: (.issues // []);

"## Fugazi report\n\n" +
(if (issuesArr | length) == 0 then
  "No issues found."
else
  "**Total issues:** \(issuesArr | length)\n\n" +
  "| Rule | File | Line | Severity |\n| --- | --- | --- | --- |\n" +
  (issuesArr
    | sort_by(.severity, .ruleId)
    | .[0:50]
    | map("| `\(.ruleId)` | `\(.file)` | \(.startLine // .line // 1) | \(.severity) |")
    | join("\n"))
end)
