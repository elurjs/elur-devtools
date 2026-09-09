// No manual devtools import needed: @elurjs/vite-plugin-elur injects
// @elurjs/devtools-backend/auto and @elurjs/query/devtools automatically
// in dev mode (devtools: "auto").
import {
    ElurComponent,
    Link,
    RouterView,
    computed,
    createRouter,
    createStore,
    html,
    mount,
    repeat,
    signal,
} from "@elurjs/core";
import {
    createCommand,
    createQuery,
    getQueryData,
    setQueryData,
} from "@elurjs/query";

interface DemoUser {
    id: number;
    name: string;
    role: "admin" | "editor" | "viewer";
    profile: {
        location: string;
        skills: string[];
    };
}

const wait = (ms: number, abortSignal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        abortSignal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Request aborted", "AbortError"));
            },
            { once: true },
        );
    });

let serverUsers: DemoUser[] = [
    {
        id: 1,
        name: "Ada Lovelace",
        role: "admin",
        profile: { location: "London", skills: ["Mathematics", "Algorithms"] },
    },
    {
        id: 2,
        name: "Grace Hopper",
        role: "editor",
        profile: { location: "New York", skills: ["Compilers", "COBOL"] },
    },
    {
        id: 3,
        name: "Linus Torvalds",
        role: "viewer",
        profile: { location: "Helsinki", skills: ["Kernels", "Git"] },
    },
];

const count = signal(4);
const newUserName = signal("");
const failNextRequest = signal(false);
const settings = signal({
    theme: "dark",
    notifications: {
        email: true,
        push: false,
        digest: { frequency: "weekly", hour: 9 },
    },
    experiments: ["signal-inspector", "query-actions"],
});
const doubledCount = computed(() => count.value * 2);

const todos = createStore(
    {
        items: [
            { id: 1, text: "Inspect nested signals", done: true },
            { id: 2, text: "Invalidate a query from DevTools", done: false },
            { id: 3, text: "Watch command queues", done: false },
        ],
    },
    {
        name: "demo-todos",
        actions: (state) => ({
            toggle: (id: number) => {
                state.items.value = state.items.value.map((item) =>
                    item.id === id ? { ...item, done: !item.done } : item,
                );
            },
            add: (text: string) => {
                state.items.value = [
                    ...state.items.value,
                    { id: Date.now(), text, done: false },
                ];
            },
        }),
    },
);

const usersQuery = createQuery("users/list", async () => {
    await wait(650);
    return structuredClone(serverUsers);
});

const dashboardQuery = createQuery("dashboard/stats", async () => {
    await wait(450);
    return {
        totals: { users: serverUsers.length, projects: 7, tasks: 24 },
        activity: [
            { day: "Mon", commits: 12 },
            { day: "Tue", commits: 18 },
            { day: "Wed", commits: 9 },
        ],
        health: { api: "operational", database: "operational", latencyMs: 38 },
    };
});

const unreliableQuery = createQuery("lab/unreliable", async () => {
    await wait(500);
    if (failNextRequest.value) {
        failNextRequest.value = false;
        throw new Error("Intentional demo failure");
    }
    return {
        ok: true,
        receivedAt: new Date().toISOString(),
        nested: { request: { retries: 0, region: "local-demo" } },
    };
});

const addUserCommand = createCommand<
    string,
    DemoUser,
    { previous: DemoUser[]; optimisticId: number }
>(
    "users/create",
    async (name, { signal: abortSignal }) => {
        await wait(900, abortSignal);
        const user: DemoUser = {
            id: Math.max(...serverUsers.map((entry) => entry.id), 0) + 1,
            name,
            role: "viewer",
            profile: { location: "Remote", skills: ["Elur"] },
        };
        serverUsers = [...serverUsers, user];
        return user;
    },
    {
        mode: "latest",
        onMutate: (name) => {
            const previous = getQueryData<DemoUser[]>("users/list") ?? [];
            const optimisticId = -Date.now();
            setQueryData("users/list", [
                ...previous,
                {
                    id: optimisticId,
                    name,
                    role: "viewer",
                    profile: { location: "Saving…", skills: [] },
                },
            ]);
            return { previous, optimisticId };
        },
        onSuccess: (user, _name, context) => {
            const current = getQueryData<DemoUser[]>("users/list") ?? [];
            setQueryData(
                "users/list",
                current.map((entry) => (entry.id === context?.optimisticId ? user : entry)),
            );
        },
        onError: (_error, _name, context) => {
            setQueryData("users/list", context?.previous ?? []);
        },
    },
);

const saveSettingsCommand = createCommand(
    "settings/save",
    async (value: typeof settings.value, { signal: abortSignal }) => {
        await wait(1200, abortSignal);
        return { savedAt: new Date().toISOString(), value };
    },
    { mode: "latest", dedupeWindowMs: 150 },
);

const queuedJobCommand = createCommand(
    "jobs/process",
    async (job: { id: number }, { signal: abortSignal }) => {
        await wait(1000, abortSignal);
        return { ...job, completedAt: Date.now() };
    },
    { mode: "queue" },
);

class CounterCard extends ElurComponent {
    title = "Fine-grained counter";

    render() {
        return html`
            <article class="card">
                <div class="card-heading">
                    <div>
                        <span class="eyebrow">Signal</span>
                        <h2>${this.title}</h2>
                    </div>
                    <span class="pill">main.ts:count</span>
                </div>
                <div class="counter-value">${() => count.value}</div>
                <p class="muted-text">Computed double: ${() => doubledCount.value}</p>
                <div class="actions">
                    <button @click=${() => count.update((value) => value - 1)}>Decrease</button>
                    <button class="primary" @click=${() => count.update((value) => value + 1)}>
                        Increase
                    </button>
                    <button @click=${() => (count.value = 0)}>Reset</button>
                </div>
            </article>
        `;
    }
}

class QuerySummaryCard extends ElurComponent {
    title = "Dashboard query";

    render() {
        return html`
            <article class="card">
                <div class="card-heading">
                    <div>
                        <span class="eyebrow">Query</span>
                        <h2>${this.title}</h2>
                    </div>
                    <span class=${() => `pill status-${dashboardQuery.status.value}`}>
                        ${() => dashboardQuery.status.value}
                    </span>
                </div>
                ${() => {
                const data = dashboardQuery.data.value;
                if (!data) return html`<p class="muted-text">Loading nested statistics…</p>`;
                return html`
                        <div class="stats-grid">
                            <div><strong>${data.totals.users}</strong><span>users</span></div>
                            <div><strong>${data.totals.projects}</strong><span>projects</span></div>
                            <div><strong>${data.totals.tasks}</strong><span>tasks</span></div>
                        </div>
                        <p class="muted-text">
                            API ${data.health.api} · ${data.health.latencyMs} ms
                        </p>
                    `;
            }}
                <button @click=${dashboardQuery.refetch}>Refetch dashboard/stats</button>
            </article>
        `;
    }
}

class HomePage extends ElurComponent {
    pageName = "HomePage";

    render() {
        return html`
            <section class="page">
                <div class="hero">
                    <div>
                        <span class="eyebrow">Interactive playground</span>
                        <h1>Elur DevTools demo</h1>
                        <p>
                            Change signals, navigate routes, inspect nested data and control the
                            Query cache directly from the browser extension.
                        </p>
                    </div>
                    <span class="hero-badge">${this.pageName}</span>
                </div>
                <div class="card-grid">
                    ${new CounterCard()}
                    ${new QuerySummaryCard()}
                </div>
                <article class="card wide">
                    <div class="card-heading">
                        <div>
                            <span class="eyebrow">Store</span>
                            <h2>Reactive checklist</h2>
                        </div>
                        <span class="pill">demo-todos</span>
                    </div>
                    <div class="todo-list">
                        ${() =>
                repeat(
                    todos.items.value,
                    (item) => `${item.id}:${item.done}`,
                    (item) => html`
                                    <label class="todo-row">
                                        <input
                                            type="checkbox"
                                            checked=${item.done}
                                            @change=${() => todos.toggle(item.id)}
                                        />
                                        <span>${item.text}</span>
                                    </label>
                                `,
                )}
                    </div>
                    <button @click=${() => todos.add(`Task ${todos.items.value.length + 1}`)}>
                        Add task
                    </button>
                </article>
            </section>
        `;
    }
}

class UsersPage extends ElurComponent {
    pageName = "UsersPage";

    render() {
        return html`
            <section class="page">
                <div class="page-heading">
                    <div>
                        <span class="eyebrow">Cached collection</span>
                        <h1>Users</h1>
                    </div>
                    <span class=${() => `pill status-${usersQuery.status.value}`}>
                        ${() => usersQuery.status.value}
                    </span>
                </div>
                <article class="card wide">
                    <div class="form-row">
                        <input
                            placeholder="New user name"
                            value=${() => newUserName.value}
                            @input=${(event: Event) => {
                newUserName.value = (event.target as HTMLInputElement).value;
            }}
                        />
                        <button
                            class="primary"
                            disabled=${() =>
                addUserCommand.isPending.value || newUserName.value.trim().length < 2}
                            @click=${() => {
                const name = newUserName.value.trim();
                if (!name) return;
                addUserCommand.execute(name);
                newUserName.value = "";
            }}
                        >
                            ${() => (addUserCommand.isPending.value ? "Saving…" : "Add optimistically")}
                        </button>
                        <button @click=${usersQuery.refetch}>Refetch</button>
                    </div>
                    ${() =>
                addUserCommand.error.value
                    ? html`<p class="error-text">${String(addUserCommand.error.value)}</p>`
                    : null}
                    ${() => {
                if (usersQuery.status.value === "pending") {
                    return html`<p class="muted-text">Loading users…</p>`;
                }
                if (usersQuery.status.value === "error") {
                    return html`<p class="error-text">Could not load users.</p>`;
                }
                return repeat(
                    usersQuery.data.value ?? [],
                    (user) => user.id,
                    (user) => html`
                                <div class="user-row">
                                    <div class="avatar">${user.name.slice(0, 1)}</div>
                                    <div class="user-copy">
                                        <strong>${user.name}</strong>
                                        <span>${`${user.profile.location} — ${user.profile.skills.join(", ")}`}</span>
                                    </div>
                                    <span class="pill">${user.role}</span>
                                </div>
                            `,
                );
            }}
                </article>
            </section>
        `;
    }
}

class QueryLabPage extends ElurComponent {
    render() {
        return html`
            <section class="page">
                <div class="page-heading">
                    <div>
                        <span class="eyebrow">Failure and concurrency lab</span>
                        <h1>Query laboratory</h1>
                    </div>
                </div>
                <div class="card-grid">
                    <article class="card">
                        <div class="card-heading">
                            <h2>Unreliable query</h2>
                            <span class=${() => `pill status-${unreliableQuery.status.value}`}>
                                ${() => unreliableQuery.status.value}
                            </span>
                        </div>
                        <pre>${() => JSON.stringify(unreliableQuery.data.value, null, 2) ?? "No data"}</pre>
                        ${() =>
                unreliableQuery.error.value
                    ? html`<p class="error-text">${String(unreliableQuery.error.value)}</p>`
                    : null}
                        <div class="actions">
                            <button @click=${unreliableQuery.refetch}>Successful refetch</button>
                            <button
                                class="danger"
                                @click=${() => {
                failNextRequest.value = true;
                unreliableQuery.refetch();
            }}
                            >
                                Force next error
                            </button>
                        </div>
                    </article>
                    <article class="card">
                        <div class="card-heading">
                            <h2>Queued commands</h2>
                            <span class="pill">jobs/process</span>
                        </div>
                        <p class="muted-text">
                            Queue three jobs, then inspect the Query tab while they execute.
                        </p>
                        <div class="stats-grid">
                            <div><strong>${() => queuedJobCommand.inFlight.value}</strong><span>in flight</span></div>
                            <div><strong>${() => queuedJobCommand.queuedCount.value}</strong><span>queued</span></div>
                            <div><strong>${() => queuedJobCommand.status.value}</strong><span>status</span></div>
                        </div>
                        <button
                            class="primary"
                            @click=${() => {
                const start = Date.now();
                queuedJobCommand.execute({ id: start });
                queuedJobCommand.execute({ id: start + 1 });
                queuedJobCommand.execute({ id: start + 2 });
            }}
                        >
                            Queue three jobs
                        </button>
                    </article>
                </div>
            </section>
        `;
    }
}

class SettingsPage extends ElurComponent {
    render() {
        return html`
            <section class="page">
                <div class="page-heading">
                    <div>
                        <span class="eyebrow">Nested object signal</span>
                        <h1>Settings</h1>
                    </div>
                    <span class="pill">${() => saveSettingsCommand.status.value}</span>
                </div>
                <article class="card wide">
                    <div class="setting-row">
                        <div><strong>Theme</strong><span>Current: ${() => settings.value.theme}</span></div>
                        <button
                            @click=${() =>
                settings.update((value) => ({
                    ...value,
                    theme: value.theme === "dark" ? "light" : "dark",
                }))}
                        >
                            Toggle theme
                        </button>
                    </div>
                    <div class="setting-row">
                        <div>
                            <strong>Email notifications</strong>
                            <span>${() => (settings.value.notifications.email ? "Enabled" : "Disabled")}</span>
                        </div>
                        <button
                            @click=${() =>
                settings.update((value) => ({
                    ...value,
                    notifications: {
                        ...value.notifications,
                        email: !value.notifications.email,
                    },
                }))}
                        >
                            Toggle email
                        </button>
                    </div>
                    <pre>${() => JSON.stringify(settings.value, null, 2)}</pre>
                    <button
                        class="primary"
                        disabled=${() => saveSettingsCommand.isPending.value}
                        @click=${() => saveSettingsCommand.execute(structuredClone(settings.value))}
                    >
                        ${() => (saveSettingsCommand.isPending.value ? "Saving latest…" : "Save settings")}
                    </button>
                </article>
            </section>
        `;
    }
}

class AboutPage extends ElurComponent {
    render() {
        return html`
            <section class="page">
                <div class="hero">
                    <div>
                        <span class="eyebrow">Architecture</span>
                        <h1>What this demo covers</h1>
                        <p>Class components, signals, computed state, stores, router guards, queries and commands.</p>
                    </div>
                </div>
                <article class="card wide prose">
                    <p>Open the <strong>Elur</strong> panel and keep it visible while interacting.</p>
                    <ul>
                        <li>Components mount and unmount as you navigate.</li>
                        <li>Signal objects can be expanded recursively.</li>
                        <li>Query cache entries expose their complete inspectable data.</li>
                        <li>Invalidate and Clear perform real cache operations.</li>
                    </ul>
                </article>
            </section>
        `;
    }
}

class AppShell extends ElurComponent {
    appName = "Elur DevTools Lab";

    render() {
        return html`
            <div class="app-shell">
                <aside class="sidebar">
                    <div class="logo"><span>E</span><strong>${this.appName}</strong></div>
                    <nav>
                        ${new Link("/", "Overview")}
                        ${new Link("/users", "Users")}
                        ${new Link("/query-lab", "Query lab")}
                        ${new Link("/settings", "Settings")}
                        ${new Link("/about", "About")}
                    </nav>
                    <div class="sidebar-note">
                        <span class="pulse-dot"></span>
                        DevTools backend active
                    </div>
                </aside>
                <main class="main-content">${new RouterView()}</main>
            </div>
        `;
    }
}

const router = createRouter([
    { path: "/", component: () => new HomePage() },
    { path: "/users", component: () => new UsersPage() },
    { path: "/query-lab", component: () => new QueryLabPage() },
    { path: "/settings", component: () => new SettingsPage() },
    { path: "/about", component: () => new AboutPage() },
]);

router.beforeEach(function demoNavigationGuard() {
    return true;
});

mount(new AppShell(), "#app", { router });
