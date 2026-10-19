#!/bin/sh
path="$*"
case "$path" in
  *issue/PROJ-123/comment*)
    echo '{"comments":[],"total":0}' ;;
  *issue/PROJ-123*expand=*names*)
    cat <<'JSON'
{"key":"PROJ-123","fields":{"issuetype":{"name":"Story"},"summary":"Agent export","status":{"name":"To Refine"},"description":null,
"customfield_10412":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Operators cannot export an agent's configuration to move it between storefronts."}]}]},
"customfield_10413":{"type":"doc","version":1,"content":[{"type":"orderedList","content":[
{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"add GET /export"}]}]},
{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"serialise hooks"}]}]},
{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"serialise variables"}]}]},
{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"zip"}]}]},
{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"add download button"}]}]}]}]},
"customfield_10414":"Store operators with more than one storefront"},
"names":{"issuetype":"Issue Type","summary":"Summary","status":"Status","description":"Description","customfield_10412":"Problem statement","customfield_10413":"Proposed solution","customfield_10414":"Who is affected"}}
JSON
    ;;
  *issue/PROJ-123*)
    echo '{"key":"PROJ-123","fields":{"issuetype":{"name":"Story"},"summary":"Agent export","status":{"name":"To Refine"},"description":null,"labels":[],"comment":{"comments":[],"total":0}}}' ;;
  *)
    echo '{"errorMessages":["Not found or not supported by this stub"]}'; exit 1 ;;
esac
