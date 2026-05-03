def issuesArr: (.issues // []);

[issuesArr[]
  | select(.category == "health")
  | {
      path: .file,
      line: (.startLine // .line // 1),
      side: "RIGHT",
      body: "Fugazi health: \(.metric // .ruleId) = \(.value // "n/a") - \(.message)"
    }]
