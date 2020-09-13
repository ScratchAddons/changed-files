import * as core from "@actions/core"
import { context, getOctokit } from "@actions/github"

type GitHub = ReturnType<typeof getOctokit>

interface File {
    readonly status: string
    readonly filename: string
    readonly previous_filename?: string
}

interface Commit {
    readonly sha: string
    readonly author: object
    readonly message: string
    readonly distinct: boolean
    readonly url: string
}

class ChangedFiles {
    readonly updated: string[] = []
    readonly created: string[] = []
    readonly deleted: string[] = []

    constructor(private readonly pattern: RegExp) {}

    apply(f: File): void {
        if (!this.pattern.test(f.filename)) {
            return
        }
        switch (f.status) {
            case "added":
                this.created.push(f.filename)
                break
            case "removed":
                this.deleted.push(f.filename)
                break
            case "modified":
                this.updated.push(f.filename)
                break
            case "renamed":
                this.created.push(f.filename)
                if (f.previous_filename && this.pattern.test(f.previous_filename)) {
                    this.deleted.push(f.previous_filename)
                }
        }
    }
}

async function getChangedFilesPR(client: GitHub, prNumber: number): Promise<ChangedFiles> {
    const pattern = core.getInput("pattern")
    const changedFiles = new ChangedFiles(new RegExp(pattern.length ? pattern : ".*"))
    const iterator = client.paginate.iterator(client.rest.pulls.listFiles, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        per_page: 100,
    })
    for await (const { data: files } of iterator) {
        files.forEach(f => changedFiles.apply(f))
    }
    return changedFiles
}

async function getChangedFilesPush(client: GitHub, commits: Array<Commit>): Promise<ChangedFiles> {
    const pattern = core.getInput("pattern")
    const changedFiles = new ChangedFiles(new RegExp(pattern.length ? pattern : ".*"))

    await commits.forEach(async commit => {
        core.debug(`Calling client.repos.getCommit() with ref {commit.sha}`)
        if (commit.distinct) {
            const commitData = await client.repos.getCommit({
                owner: context.repo.owner,
                repo: context.repo.repo,
                ref: commit.sha
            })
            commitData.data.files.forEach(f => changedFiles.apply(f))
        }
    })
    return changedFiles
}

function extractPrNumber(): number | undefined {
    const prNumberInput = core.getInput("pr-number")

    // If user provides pull request number, we fetch and return that particular pull request
    if (prNumberInput) {
        return parseInt(prNumberInput, 10)
    }

    // Try to infer the pull request from the event's context
    if (context.payload.pull_request) {
        return context.payload.pull_request.number
    }

    // FIXME: This is a hack to get the PR number from the "merge_group" event
    if (context.payload["merge_group"]) {
        const match = /pr-(\d+)-/.exec(context.payload["merge_group"]["head_ref"])?.[1]
        if (match) {
            return parseInt(match, 10)
        }
    }

    return undefined
}

async function fetchPush(): Promise<{ commits: Array<Commit> } | undefined> {
    return context.payload['push'] ? { commits: context.payload['push'].commits } : undefined
}

function getEncoder(): (files: string[]) => string {
    const encoding = core.getInput("result-encoding") || "string"
    switch (encoding) {
        case "json":
            return JSON.stringify
        case "string":
            return files => files.join("\n")
        default:
            throw new Error("'result-encoding' must be either 'string' or 'json'")
    }
}

async function run(): Promise<void> {
    const token = core.getInput("repo-token", { required: true })
    const eventInput = core.getInput("event")
    const event = eventInput ? eventInput : context.eventName
    const client = getOctokit(token)

    let changedFiles

    switch (event) {
        case 'push':
            const push = await fetchPush()

            if (!push) {
                core.setFailed(`Could not get push from context, exiting`)
                return
            }

            core.debug(`${push.commits} commits found`)

            changedFiles = await getChangedFilesPush(client, push.commits)
            break

        case 'pull_request':
            const pr = extractPrNumber()

            if (!pr) {
                core.setFailed(`Could not get pull request from context, exiting`)
                return
            }

            core.debug(`calculating changed files for pr #${pr}`)

            changedFiles = await getChangedFilesPR(client, pr)
            break
    }


    const encoder = getEncoder()
    
    let hasChanged = false
    const totalModified =
        changedFiles.created.length + changedFiles.updated.length + changedFiles.deleted.length
    if (totalModified > 0) {
        hasChanged = true
    }

    core.setOutput("changed", String(hasChanged))
    core.setOutput("files_created", encoder(changedFiles.created))
    core.setOutput("files_updated", encoder(changedFiles.updated))
    core.setOutput("files_deleted", encoder(changedFiles.deleted))
}

run().catch(err => {
    console.error(err)
    core.setFailed(`Unhandled error: ${err}`)
})
