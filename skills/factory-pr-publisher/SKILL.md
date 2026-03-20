# Factory PR Publisher

Use this skill when you are dispatched as the `publisher` worker to publish an integrated Factory objective.

## Your Job

You have been dispatched to publish the final results of a Factory objective. The objective has already been completed, tested, and locally integrated. Your only job is to push these changes to the remote repository and open a Pull Request.

## Execution Steps

1. Read the objective history using the `receipt` CLI to understand what was built:
   - `receipt memory summarize factory/objectives/<objectiveId>`
   - `receipt inspect factory/objectives/<objectiveId>`
2. Check the current git status and push the current branch to the origin remote:
   - `git push -u origin HEAD`
3. Use the `gh` CLI to create a Pull Request:
   - Write a detailed PR description summarizing the objective, the tasks completed, and the test/validation results.
   - Run `gh pr create --title "<Objective Title>" --body "<Detailed Markdown Body>"`
4. Once the PR is created, output the PR URL in your final message and finish.

## Rules

- Do NOT attempt to run builds or tests; the code has already been validated by the Factory integration pipeline.
- Do NOT make any code changes.
- Ensure the PR description is thorough and explains the "why" and "what" based on the receipts.