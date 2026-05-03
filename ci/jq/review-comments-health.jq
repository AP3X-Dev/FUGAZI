def issuesArr: (.issues // []);
[issuesArr[]
  | select(.category == "health")
  | {
      body: "Fugazi health: \(.metric // .ruleId) = \(.value // "n/a") - \(.message)",
      position: {
        position_type: "text",
        new_path: .file,
        new_line: (.startLine // .line // 1)
      }
    }]
