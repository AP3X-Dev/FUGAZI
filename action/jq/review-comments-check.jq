def issuesArr: (.issues // []);

[issuesArr[]
  | select(.category == "check" or (.category | not))
  | {
      path: .file,
      line: (.startLine // .line // 1),
      side: "RIGHT",
      body: "[\(.ruleId)] \(.message)"
    }]
