# Deduplicate review comments. Two comments are duplicates iff they have
# the same (path, line, body) triple. Used when posting an updated review
# over an existing one to avoid double-posting.
.
| group_by([.path, .line, .body])
| map(.[0])
