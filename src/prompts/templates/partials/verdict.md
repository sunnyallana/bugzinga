## Output contract (MANDATORY)

Write the artifact file: `{{ARTIFACT}}`

The LAST line of that file must be exactly one verdict line of the form:

    BUGZINGA_VERDICT: <verdict>

where `<verdict>` is one of: {{VERDICT_OPTIONS}}

The pipeline parses this line mechanically — if it is missing or malformed the phase counts as failed and is retried. Choose the verdict honestly based on what actually happened; never claim success you did not verify yourself.

{{DISCIPLINE}}
{{FEEDBACK}}
