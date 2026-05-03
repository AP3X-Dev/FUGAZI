def dupes: ((.duplicates // .clones // []));
[dupes[]
  | . as $family
  | $family.instances[] as $inst
  | {
      body: "Clone family \($family.id) (similarity \($family.similarity // 1.0))",
      position: {
        position_type: "text",
        new_path: ($inst.uri | sub("file://"; "")),
        new_line: $inst.startLine
      }
    }]
