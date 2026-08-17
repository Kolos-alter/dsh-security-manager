window.__ModuleLoader__.load({
	id: "dsh-security-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ---------- locale ----------
		const NS = "settings.security";
		const zh = {
			tab: "安全", intro: "自动识别已安装插件并定位其 npm / GitHub 来源；更新前自动快照，可随时回退。",
			loading: "正在读取…", empty: "profile 中尚未安装任何插件。", error: "读取失败，请重试或检查服务是否正常。",
			version: "版本", enabled: "已启用", disabled: "已停用", unmounted: "未挂载",
			checkUpdate: "检查更新", update: "更新", updating: "更新中…", rollback: "回退",
			rollbackConfirm: "确认回退到该快照？（会还原插件版本与配置）",
			snapshots: "快照历史", noSnapshots: "暂无快照（更新前会自动创建）",
			latestVersion: "最新版本", noSnapshotFor: "没有可用于该插件的快照",
			ok: "操作成功", fail: "操作失败", none: "无",
			security: "安全", sourceNpm: "npm", sourceGithub: "GitHub", sourceUnknown: "来源未知",
			repo: "仓库",
		};
		const en = {
			tab: "Security", intro: "Auto-discovers installed plugins and locates their npm / GitHub source; snapshots before every update, rollback anytime.",
			loading: "Loading…", empty: "No plugins installed in this profile.", error: "Failed to load; retry or check the service.",
			version: "Version", enabled: "Enabled", disabled: "Disabled", unmounted: "Not mounted",
			checkUpdate: "Check update", update: "Update", updating: "Updating…", rollback: "Rollback",
			rollbackConfirm: "Roll back to this snapshot? (restores plugin version and config)",
			snapshots: "Snapshot history", noSnapshots: "No snapshots yet (created automatically before updates)",
			latestVersion: "Latest version", noSnapshotFor: "No snapshot available for this plugin",
			ok: "Done", fail: "Failed", none: "None",
			security: "Security", sourceNpm: "npm", sourceGithub: "GitHub", sourceUnknown: "Unknown source",
			repo: "Repo",
		};

		// ---------- styles (mirror the shipped settings design) ----------
		const css = [
			".dshsec_wrap{max-width:760px;display:flex;flex-direction:column;gap:12px}",
			".dshsec_cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}",
			".dshsec_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
			".dshsec_row{display:flex;align-items:center;gap:12px}",
			".dshsec_head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".dshsec_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".dshsec_sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;word-break:break-all}",
			".dshsec_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".dshsec_badgeOk{background:rgba(52,199,89,.14);color:var(--dsw-alias-state-success,var(--dsw-alias-label-primary))}",
			".dshsec_badgeErr{background:rgba(255,59,48,.14);color:var(--dsw-alias-label-error)}",
			".dshsec_badgeSrc{background:rgba(90,140,255,.14);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary))}",
			".dshsec_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dshsec_btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:transparent}",
			".dshsec_btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".dshsec_btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}",
			".dshsec_btn:disabled{opacity:.4;cursor:default}",
			".dshsec_msg{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".dshsec_msgOk{color:var(--dsw-alias-state-success,var(--dsw-alias-label-primary))}",
			".dshsec_msgErr{color:var(--dsw-alias-label-error)}",
			".dshsec_snaps{border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px;padding-top:10px;display:flex;flex-direction:column;gap:6px}",
			".dshsec_snap{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".dshsec_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}",
			".dshsec_snapBtn{padding:2px 10px;font-size:12px}",
		].join("\n");
		const CSS_ID = "dsh-security-manager/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-security-manager";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ---------- API ----------
		const BASE = "/api/security-manager";
		function apiGet(name) {
			return fetch(BASE + "/" + name).then((r) => r.json());
		}
		function apiPost(name, body) {
			return fetch(BASE + "/" + name, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {}),
			}).then((r) => r.json());
		}

		// ---------- components ----------
		const h = react.createElement;

		function Badge(props) {
			return h("span", { className: "dshsec_badge " + (props.cls || "") }, props.children);
		}

		function sourceLabel(t, source) {
			if (source === "npm" || source === "npm+github") return t("sourceNpm") + (source === "npm+github" ? "+" + t("sourceGithub") : "");
			if (source === "github") return t("sourceGithub");
			return t("sourceUnknown");
		}

		function PluginCard(props) {
			const it = props.it;
			const busy = props.busy;
			const t = props.t;
			return h("li", { className: "dshsec_card" },
				h("div", { className: "dshsec_row" },
					h("div", { className: "dshsec_head" },
						h("span", { className: "dshsec_name" }, it.package),
						h("span", { className: "dshsec_sub" }, t("version") + ": " + (it.installed || t("none"))),
						it.github ? h("span", { className: "dshsec_sub" }, t("repo") + ": github.com/" + it.github) : null,
					),
					it.security ? h(Badge, { cls: "dshsec_badgeOk" }, it.securityLabel || t("security")) : null,
					h(Badge, { cls: "dshsec_badgeSrc" }, sourceLabel(t, it.source)),
					it.mounted ? h(Badge, {}, it.enabled ? t("enabled") : t("disabled")) : null,
				),
				h("div", { className: "dshsec_actions" },
					h("button", { type: "button", className: "dshsec_btn", disabled: busy !== "",
						onClick: () => props.onAction("check", it) }, t("checkUpdate")),
					h("button", { type: "button", className: "dshsec_btn dshsec_btnPrimary", disabled: busy !== "",
						onClick: () => props.onAction("update", it) }, busy === "update" ? t("updating") : t("update")),
					h("button", { type: "button", className: "dshsec_btn", disabled: busy !== "",
						onClick: () => props.onAction("rollback", it) }, t("rollback")),
				),
			);
		}

		function SecurityPluginsTab({ t }) {
			const [items, setItems] = react.useState(null);
			const [snapshots, setSnapshots] = react.useState(null);
			const [busy, setBusy] = react.useState("");
			const [msg, setMsg] = react.useState(null);

			const load = react.useCallback(async () => {
				try {
					const list = await apiGet("status");
					const snaps = await apiGet("snapshots");
					setItems(list && list.ok ? list.items : []);
					setSnapshots(snaps && snaps.ok ? snaps.snapshots : []);
				} catch (err) {
					setMsg({ kind: "err", text: String(err && err.message ? err.message : err) });
				}
			}, []);

			react.useEffect(() => { load(); }, [load]);

			const onAction = async (kind, target) => {
				if (busy !== "") return;
				if ((kind === "rollback" || kind === "rollback-snap") && !window.confirm(t("rollbackConfirm"))) return;
				setBusy(kind);
				setMsg(null);
				try {
					let r = null;
					if (kind === "check") {
						r = await apiPost("update-check", { package: target.package });
						if (r && r.ok) {
							const parts = [t("version") + ": " + (target.installed || t("none"))];
							if (r.latest) parts.push(t("latestVersion") + ": " + r.latest);
							if (r.github) parts.push(t("repo") + ": " + r.github);
							setMsg({ kind: "ok", text: parts.join(" | ") });
							await load();
							return;
						}
					} else if (kind === "update") {
						r = await apiPost("update", { package: target.package });
					} else if (kind === "rollback") {
						const snaps = await apiGet("snapshots");
						const list = snaps && snaps.ok ? snaps.snapshots : [];
						const snap = list.find((s) => s.dependencies && s.dependencies[target.package]);
						if (!snap) { setMsg({ kind: "err", text: t("noSnapshotFor") }); return; }
						r = await apiPost("rollback", { snapshot: snap.name });
					} else if (kind === "rollback-snap") {
						r = await apiPost("rollback", { snapshot: target.name });
					}
					if (r) setMsg({ kind: r.ok ? "ok" : "err", text: r.ok ? (r.snapshot || r.after || t("ok")) : (r.error || r.stderrTail || t("fail")) });
					await load();
				} catch (err) {
					setMsg({ kind: "err", text: String(err && err.message ? err.message : err) });
				} finally {
					setBusy("");
				}
			};

			const sorted = items === null ? [] : [...items].sort((a, b) => (b.security === a.security ? 0 : b.security ? 1 : -1));

			return h("div", { className: "dshsec_wrap" },
				h("p", { className: "dshsec_empty" }, t("intro")),
				items === null
					? h("p", { className: "dshsec_empty" }, t("loading"))
					: (items.length === 0
						? h("p", { className: "dshsec_empty" }, t("empty"))
						: h("ul", { className: "dshsec_cards" },
							sorted.map((it) => h(PluginCard, { key: it.package, it, busy, t, onAction })),
						)),
				msg ? h("p", { className: "dshsec_msg " + (msg.kind === "ok" ? "dshsec_msgOk" : "dshsec_msgErr") }, msg.text) : null,
				h("div", { className: "dshsec_snaps" },
					h("span", { className: "dshsec_name", style: { fontSize: 13 } }, t("snapshots")),
					snapshots === null
						? h("p", { className: "dshsec_empty" }, t("loading"))
						: (snapshots.length === 0
							? h("p", { className: "dshsec_empty" }, t("noSnapshots"))
							: snapshots.map((s) =>
								h("div", { key: s.name, className: "dshsec_snap" },
									h("span", null, s.name),
									h("button", { type: "button", className: "dshsec_btn dshsec_snapBtn", disabled: busy !== "",
										onClick: () => onAction("rollback-snap", s) }, t("rollback")),
								))),
				),
			);
		}

		// ---------- plugin ----------
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "security-manager: dictionaries");
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "security",
				order: 20,
				label: () => t("tab"),
				locale: NS,
				inject: () => ({}),
			}, SecurityPluginsTab));
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
