def dupes: ((.duplicates // .clones // []));

"## Duplication summary\n\n" +
(if (dupes | length) == 0 then
  "No clone families detected."
else
  "**Clone families:** \(dupes | length)\n\n" +
  "| Family | Similarity | Instances |\n| --- | --- | --- |\n" +
  (dupes
    | sort_by(-(.instances | length))
    | .[0:25]
    | map("| `\(.id)` | \(.similarity // 1.0) | \(.instances | length) |")
    | join("\n"))
end)
