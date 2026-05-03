def issuesArr: (.issues // []);
# Substitutes CI_PROJECT_URL where the GitHub variant uses GH_REPO.
[issuesArr[]
  | select(.category == "check" or (.category | not))
  | {
      body: "[\(.ruleId)] \(.message)",
      position: {
        position_type: "text",
        new_path: .file,
        new_line: (.startLine // .line // 1)
      }
    }]
