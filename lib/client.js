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
			tab: "安全",
			intro: "本地静态审计已安装插件：安装期执行、来源可复现性、能力面。更新前先看风险差异，回退可只回一个包。",
			loading: "正在审计…", empty: "profile 中尚未安装任何插件。", error: "读取失败，请重试。",
			rescan: "重新审计", score: "评分", grade: "等级",
			sevHigh: "高", sevMedium: "中", sevLow: "低", sevInfo: "提示",
			noIssues: "未发现计分问题", inventory: "能力清单", inventoryShow: "展开", inventoryHide: "收起",
			installed: "已装", spec: "安装来源", repo: "仓库", location: "本地源",
			checkUpdate: "检查更新", upToDate: "已是最新", latestIs: "最新版本",
			preview: "预览更新", previewing: "预览中…", previewSafe: "该更新未引入安装期执行",
			previewDanger: "该更新引入/变更了安装期执行脚本，请谨慎",
			update: "更新", updating: "更新中…", confirmUpdate: "确认更新该插件？会先自动创建快照。",
			snapshots: "快照历史", noSnapshots: "暂无快照（更新前会自动创建）",
			snapshotDiff: "差异", closeDiff: "收起", restoreAll: "整表回退",
			confirmRestoreAll: "确认按该快照整体回退？（还原 package.json / cordis.patch.yml / pnpm-lock.yaml 并重新安装）",
			changedTo: "变化", noChanges: "与当前一致，无差异",
			rollbackPkg: "回退此包",
			confirmRollbackPkg: "确认把该包回退到快照记录的版本？（会先自动建一个安全快照）",
			addedHint: "该包在快照中不存在，单包回退无法移除它；如需移除请用整表回退。",
			ok: "完成", fail: "失败", runtimeOn: "含运行时状态", runtimeOff: "无运行时状态",
		};
		const en = {
			tab: "Security",
			intro: "Local static audit of installed plugins: install-time execution, source reproducibility, capability surface. Review the risk diff before updating; roll back a single package.",
			loading: "Auditing…", empty: "No plugins installed in this profile.", error: "Failed to load; retry.",
			rescan: "Re-audit", score: "Score", grade: "Grade",
			sevHigh: "high", sevMedium: "medium", sevLow: "low", sevInfo: "info",
			noIssues: "No scored findings", inventory: "Capability inventory", inventoryShow: "show", inventoryHide: "hide",
			installed: "installed", spec: "install source", repo: "repo", location: "local source",
			checkUpdate: "Check update", upToDate: "up to date", latestIs: "latest",
			preview: "Preview update", previewing: "Previewing…", previewSafe: "This update adds no install-time execution",
			previewDanger: "This update adds or changes install-time execution — review carefully",
			update: "Update", updating: "Updating…", confirmUpdate: "Update this plugin? A snapshot is taken first.",
			snapshots: "Snapshot history", noSnapshots: "No snapshots yet (created automatically before updates)",
			snapshotDiff: "Diff", closeDiff: "Hide", restoreAll: "Restore all",
			confirmRestoreAll: "Restore this snapshot entirely? (package.json / cordis.patch.yml / pnpm-lock.yaml, then reinstall)",
			changedTo: "changes", noChanges: "identical to current",
			rollbackPkg: "Roll back this package",
			confirmRollbackPkg: "Roll this package back to the snapshot's recorded version? A safety snapshot is taken first.",
			addedHint: "This package is absent from the snapshot, so a single-package rollback cannot remove it — use Restore all.",
			ok: "Done", fail: "Failed", runtimeOn: "runtime state available", runtimeOff: "no runtime state",
		};

		// ---------- styles (mirror the shipped settings design) ----------
		const css = [
			".dshsec_wrap{max-width:820px;display:flex;flex-direction:column;gap:12px}",
			".dshsec_summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 16px}",
			".dshsec_grade{font-size:26px;font-weight:700;line-height:1;color:var(--dsw-alias-label-primary)}",
			".dshsec_gradeGood{color:var(--dsw-alias-state-success,var(--dsw-alias-label-primary))}",
			".dshsec_gradeWarn{color:#d08700}",
			".dshsec_gradeBad{color:var(--dsw-alias-label-error)}",
			".dshsec_cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}",
			".dshsec_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
			".dshsec_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".dshsec_head{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
			".dshsec_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".dshsec_sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;word-break:break-all}",
			".dshsec_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".dshsec_badgeOk{background:rgba(52,199,89,.14);color:var(--dsw-alias-state-success,var(--dsw-alias-label-primary))}",
			".dshsec_badgeHigh{background:rgba(255,59,48,.16);color:var(--dsw-alias-label-error)}",
			".dshsec_badgeMedium{background:rgba(255,159,10,.16);color:#b26a00}",
			".dshsec_badgeLow{background:rgba(90,140,255,.14);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary))}",
			".dshsec_badgeInfo{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}",
			".dshsec_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dshsec_btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:transparent}",
			".dshsec_btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".dshsec_btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}",
			".dshsec_btn:disabled{opacity:.4;cursor:default}",
			".dshsec_link{border:none;background:none;padding:0;cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));text-decoration:underline}",
			".dshsec_msg{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word}",
			".dshsec_msgOk{color:var(--dsw-alias-state-success,var(--dsw-alias-label-primary))}",
			".dshsec_msgErr{color:var(--dsw-alias-label-error)}",
			".dshsec_findings{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}",
			".dshsec_finding{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}",
			".dshsec_evidence{margin:2px 0 0 0;padding:0;list-style:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".dshsec_evidence code{font-size:11px;word-break:break-all}",
			".dshsec_snaps{border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px;padding-top:10px;display:flex;flex-direction:column;gap:8px}",
			".dshsec_snap{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".dshsec_snapName{color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-all;flex:1;min-width:180px}",
			".dshsec_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}",
			".dshsec_snapBtn{padding:2px 10px;font-size:12px}",
			".dshsec_diff{display:flex;flex-direction:column;gap:6px;border-left:2px solid var(--dsw-alias-border-l2);padding-left:10px;margin-left:2px}",
			".dshsec_diffRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".dshsec_mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}",
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

		const SEV_CLASS = {
			high: "dshsec_badgeHigh",
			medium: "dshsec_badgeMedium",
			low: "dshsec_badgeLow",
			info: "dshsec_badgeInfo",
		};

		function Badge(props) {
			return h("span", { className: "dshsec_badge " + (props.cls || "") }, props.children);
		}

		function gradeClass(grade) {
			if (grade === "A" || grade === "B") return "dshsec_grade dshsec_gradeGood";
			if (grade === "C") return "dshsec_grade dshsec_gradeWarn";
			return "dshsec_grade dshsec_gradeBad";
		}

		/** Install source: prefer the spec (how it was installed) over the repo URL. */
		function sourceText(it, t) {
			const spec = it.spec || "";
			if (/^(file|link|portal):/i.test(spec)) return t("location") + ": " + spec;
			if (spec) return t("spec") + ": " + spec;
			return it.github ? t("repo") + ": " + it.github : "";
		}

		function Finding(props) {
			const f = props.finding;
			const t = props.t;
			return h("li", { className: "dshsec_finding" },
				h(Badge, { cls: SEV_CLASS[f.severity] || "" }, t("sev" + f.severity.charAt(0).toUpperCase() + f.severity.slice(1))),
				h("div", null,
					h("div", null, f.title),
					h("div", { className: "dshsec_msg" }, f.detail),
					f.evidence && f.evidence.length
						? h("ul", { className: "dshsec_evidence" },
							f.evidence.slice(0, 3).map((ev, i) =>
								h("li", { key: i }, h("code", null, ev.file + (ev.line ? ":" + ev.line : "") + "  " + (ev.snippet || "")))))
						: null,
				),
			);
		}

		function PluginCard(props) {
			const it = props.it;
			const t = props.t;
			const busy = props.busy;
			const scored = it.findings.filter((f) => f.severity !== "info");
			const inventory = it.findings.filter((f) => f.severity === "info");
			const check = props.check;
			const preview = props.preview;
			const disabled = busy !== "";

			return h("li", { className: "dshsec_card" },
				h("div", { className: "dshsec_row" },
					h("div", { className: "dshsec_head" },
						h("span", { className: "dshsec_name" }, it.package),
						h("span", { className: "dshsec_sub" }, t("installed") + " " + (it.installed || "?" ) + (sourceText(it, t) ? "  ·  " + sourceText(it, t) : "")),
					),
					scored.length === 0
						? h(Badge, { cls: "dshsec_badgeOk" }, t("noIssues"))
						: scored.slice(0, 4).map((f, i) => h(Badge, { key: i, cls: SEV_CLASS[f.severity] || "" }, f.title)),
				),
				scored.length
					? h("ul", { className: "dshsec_findings" }, scored.map((f, i) => h(Finding, { key: i, finding: f, t })))
					: null,
				inventory.length
					? h("div", null,
						h("button", { type: "button", className: "dshsec_link", onClick: () => props.onToggleInventory(it.package) },
							t("inventory") + " (" + inventory.length + ") " + (props.inventoryOpen ? t("inventoryHide") : t("inventoryShow"))),
						props.inventoryOpen
							? h("ul", { className: "dshsec_findings", style: { marginTop: 6 } },
								inventory.map((f, i) => h(Finding, { key: i, finding: f, t })))
							: null)
					: null,
				h("div", { className: "dshsec_actions" },
					h("button", { type: "button", className: "dshsec_btn", disabled,
						onClick: () => props.onAction("check", it) }, t("checkUpdate")),
					h("button", { type: "button", className: "dshsec_btn", disabled,
						onClick: () => props.onAction("preview", it) }, busy === "preview" ? t("previewing") : t("preview")),
					h("button", { type: "button", className: "dshsec_btn dshsec_btnPrimary", disabled,
						onClick: () => props.onAction("update", it) }, busy === "update" ? t("updating") : t("update")),
				),
				check && check.package === it.package
					? h("p", { className: "dshsec_msg" },
						check.error
							? check.error
							: t("latestIs") + ": " + (check.latest || t("upToDate")) +
								(check.latest && check.latest !== it.installed ? "" : " (" + t("upToDate") + ")"))
					: null,
				preview && preview.package === it.package
					? h("div", null,
						h("p", { className: "dshsec_msg " + (preview.summary && preview.summary.counts.high > 0 ? "dshsec_msgErr" : "dshsec_msgOk") },
							preview.error ? preview.error
								: preview.range + "  ·  " + (preview.summary && preview.summary.counts.high > 0 ? t("previewDanger") : t("previewSafe"))),
						preview.findings && preview.findings.length
							? h("ul", { className: "dshsec_findings" }, preview.findings.map((f, i) => h(Finding, { key: i, finding: f, t })))
							: null)
					: null,
			);
		}

		function SnapshotRow(props) {
			const s = props.s;
			const t = props.t;
			const diff = props.diff;
			const open = !!diff;
			return h("div", { className: "dshsec_snap" },
				h("span", { className: "dshsec_snapName" }, s.name),
				h("button", { type: "button", className: "dshsec_btn dshsec_snapBtn", disabled: props.busy !== "",
					onClick: () => props.onDiff(s, open) }, open ? t("closeDiff") : t("snapshotDiff")),
				h("button", { type: "button", className: "dshsec_btn dshsec_snapBtn", disabled: props.busy !== "",
					onClick: () => props.onRestoreAll(s) }, t("restoreAll")),
				open
					? h("div", { className: "dshsec_diff", style: { width: "100%" } },
						diff.error
							? h("span", { className: "dshsec_msg dshsec_msgErr" }, diff.error)
							: (diff.changes.length === 0
								? h("span", { className: "dshsec_msg" }, t("noChanges"))
								: diff.changes.map((c) =>
									h("div", { key: c.package, className: "dshsec_diffRow" },
										h(Badge, { cls: c.kind === "added" ? "dshsec_badgeLow" : "dshsec_badgeMedium" }, c.kind),
										h("span", { className: "dshsec_mono" }, c.package),
										h("span", { className: "dshsec_mono" }, (c.from || "-") + "  →  " + (c.to || "-")),
										c.kind === "added"
											? h("span", { className: "dshsec_msg" }, t("addedHint"))
											: h("button", { type: "button", className: "dshsec_btn dshsec_snapBtn", disabled: props.busy !== "",
												onClick: () => props.onRollbackPkg(c.package, s) }, t("rollbackPkg")),
									))))
					: null,
			);
		}

		function SecurityPluginsTab({ t }) {
			const [audit, setAudit] = react.useState(null);
			const [snapshots, setSnapshots] = react.useState(null);
			const [busy, setBusy] = react.useState("");
			const [msg, setMsg] = react.useState(null);
			const [check, setCheck] = react.useState(null);
			const [preview, setPreview] = react.useState(null);
			const [diff, setDiff] = react.useState(null);
			const [openInv, setOpenInv] = react.useState({});

			const load = react.useCallback(async () => {
				try {
					const a = await apiGet("audit");
					const s = await apiGet("snapshots");
					if (!a || !a.ok) throw new Error(a && a.error ? a.error : "audit failed");
					setAudit(a);
					setSnapshots(s && s.ok ? s.snapshots : []);
				} catch (err) {
					setMsg({ kind: "err", text: String(err && err.message ? err.message : err) });
				}
			}, []);

			react.useEffect(() => { load(); }, [load]);

			const onAction = async (kind, target) => {
				if (busy !== "") return;
				if (kind === "update" && !window.confirm(t("confirmUpdate"))) return;
				setBusy(kind);
				setMsg(null);
				try {
					if (kind === "check") {
						const r = await apiPost("update-check", { package: target.package });
						setCheck(r && r.ok ? { package: target.package, latest: r.latest } : { package: target.package, error: (r && r.error) || t("fail") });
					} else if (kind === "preview") {
						const r = await apiPost("update-preview", { package: target.package });
						setPreview(r && r.ok
							? { package: target.package, range: (r.from || "?") + " → " + r.to, findings: r.findings, summary: r.summary }
							: { package: target.package, error: (r && r.error) || t("fail") });
					} else if (kind === "update") {
						const r = await apiPost("update", { package: target.package });
						setMsg({ kind: r && r.ok ? "ok" : "err", text: r && r.ok ? ((r.before || "?") + " → " + (r.after || "?") + "  ·  " + (r.spec || "")) : ((r && (r.error || r.stderrTail)) || t("fail")) });
						await load();
					}
				} catch (err) {
					setMsg({ kind: "err", text: String(err && err.message ? err.message : err) });
				} finally {
					setBusy("");
				}
			};

			const onRestoreAll = async (s) => {
				if (busy !== "" || !window.confirm(t("confirmRestoreAll"))) return;
				setBusy("rollback");
				setMsg(null);
				try {
					const r = await apiPost("rollback", { snapshot: s.name });
					setMsg({ kind: r && r.ok ? "ok" : "err", text: r && r.ok ? t("ok") + " (" + (r.restored || []).join(", ") + ")" : ((r && (r.error || r.stderrTail)) || t("fail")) });
					await load();
				} finally {
					setBusy("");
				}
			};

			const onRollbackPkg = async (pkg, s) => {
				if (busy !== "" || !window.confirm(t("confirmRollbackPkg"))) return;
				setBusy("rollback");
				setMsg(null);
				try {
					const r = await apiPost("rollback-package", { package: pkg, snapshot: s.name });
					setMsg({ kind: r && r.ok ? "ok" : "err", text: r && r.ok ? (pkg + ": " + (r.before || "?") + " → " + (r.after || "?")) : ((r && (r.error || r.stderrTail)) || t("fail")) });
					await load();
				} finally {
					setBusy("");
				}
			};

			const onDiff = async (s, isOpen) => {
				if (isOpen) { setDiff(null); return; }
				setBusy("diff");
				try {
					const r = await apiPost("snapshot-diff", { snapshot: s.name });
					setDiff(r && r.ok ? r : { changes: [], error: (r && r.error) || t("fail") });
				} finally {
					setBusy("");
				}
			};

			const summary = audit ? audit.summary : null;
			const counts = summary ? summary.counts : { high: 0, medium: 0, low: 0, info: 0 };
			const items = audit ? audit.items : [];

			return h("div", { className: "dshsec_wrap" },
				h("p", { className: "dshsec_empty" }, t("intro")),

				summary
					? h("div", { className: "dshsec_summary" },
						h("span", { className: gradeClass(summary.grade) }, summary.grade),
						h("div", { className: "dshsec_head" },
							h("span", { className: "dshsec_sub" }, t("score") + " " + summary.score + " / 100"),
							h("span", { className: "dshsec_sub" }, audit.runtimeAvailable ? t("runtimeOn") : t("runtimeOff")),
						),
						counts.high ? h(Badge, { cls: "dshsec_badgeHigh" }, t("sevHigh") + " " + counts.high) : null,
						counts.medium ? h(Badge, { cls: "dshsec_badgeMedium" }, t("sevMedium") + " " + counts.medium) : null,
						counts.low ? h(Badge, { cls: "dshsec_badgeLow" }, t("sevLow") + " " + counts.low) : null,
						counts.info ? h(Badge, { cls: "dshsec_badgeInfo" }, t("sevInfo") + " " + counts.info) : null,
						h("button", { type: "button", className: "dshsec_btn", disabled: busy !== "", onClick: () => load() }, t("rescan")),
					)
					: h("p", { className: "dshsec_empty" }, t("loading")),

				items.length === 0 && audit
					? h("p", { className: "dshsec_empty" }, t("empty"))
					: h("ul", { className: "dshsec_cards" },
						items.map((it) => h(PluginCard, {
							key: it.package, it, t, busy, check, preview,
							inventoryOpen: !!openInv[it.package],
							onToggleInventory: (pkg) => setOpenInv((prev) => Object.assign({}, prev, { [pkg]: !prev[pkg] })),
							onAction,
						}))),

				msg ? h("p", { className: "dshsec_msg " + (msg.kind === "ok" ? "dshsec_msgOk" : "dshsec_msgErr") }, msg.text) : null,

				h("div", { className: "dshsec_snaps" },
					h("span", { className: "dshsec_name", style: { fontSize: 13 } }, t("snapshots")),
					snapshots === null
						? h("p", { className: "dshsec_empty" }, t("loading"))
						: (snapshots.length === 0
							? h("p", { className: "dshsec_empty" }, t("noSnapshots"))
							: snapshots.map((s) => h(SnapshotRow, {
								key: s.name, s, t, busy,
								diff: diff && diff.snapshot === s.name ? diff : null,
								onDiff, onRestoreAll, onRollbackPkg,
							}))),
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
