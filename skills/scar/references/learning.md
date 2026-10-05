# Proven failure-class record

Keep scope specific enough to execute a reliable check. For contextual risks, write parameterized project/integration tests first; a static text pattern cannot prove authorization, payment correctness or all cases in a class.

```json
{
  "id": "PERSONAL-ASYNC-001",
  "title": "Detached work loses completion evidence",
  "explanation": "The caller finishes before an intentionally launched task has settled.",
  "prevention": "Await the relevant work or explicitly own and observe its lifecycle.",
  "extensions": [".js", ".ts"],
  "detector": "export default ({files}) => files.filter(f => f.text.includes('launchDetached(')).map(f => ({file:f.path,line:1,message:'Review detached lifecycle'}));",
  "fixtures": {
    "bad": [{"path":"a.js","text":"launchDetached(job);"}],
    "alternate": [{"path":"b.ts","text":"launchDetached(otherJob);"}],
    "good": [{"path":"a.js","text":"await run(job);"}]
  },
  "evidence": "Synthetic example; its detector covers only the named project API."
}
```

The example is a schema illustration, not a built-in universal rule. Write a structurally precise detector and meaningful independent fixtures for the real class. At least one valid counterexample should resemble the bad shape; trivial empty fixtures prove little.

Built-in IDs are reserved: SCAR-001 empty catch; SCAR-002 async forEach; SCAR-003 async Promise executor. They cover those syntax shapes in JS/TS and Vue script blocks. They do not replace runtime/integration tests or guarantee the absence of every async/error-handling bug.
