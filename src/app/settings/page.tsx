import Link from "next/link";
import { headers } from "next/headers";
import { Download } from "lucide-react";
import { providerStatus } from "@/lib/ai/provider";
import { canConfigureModels, getLocalModel, MODEL_ROLES } from "@/lib/ai/local-settings";
import { getProfile } from "@/lib/memory/profile";
import { DemoButton } from "@/components/DemoButton";
import { NameForm } from "@/components/NameForm";
import { LocalModelSettings } from "@/components/LocalModelSettings";
import { DemoTools } from "@/components/DemoTools";
import { instantReplies } from "@/lib/correspondents";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";

export default async function Settings() {
  const st = providerStatus();
  const localModels = canConfigureModels((await headers()).get("host"));
  const overrides = localModels ? Object.fromEntries(MODEL_ROLES.map((role) => {
    const config = getLocalModel(role);
    return [role, config && { baseUrl: config.baseUrl, model: config.model }];
  })) : {};
  const profile = await getProfile();
  const [entries, memories, letters, instant] = await Promise.all([db.entry.count({ where: CAPSULE_WHERE }), db.memory.count({ where: ACTIVE_MEMORY }), db.letter.count(), instantReplies()]);
  const rows: Array<[string, string | null, string]> = [
    ["对话 / 写信 / 代笔回信", st.chat, "CHAT_*"],
    ["看图", st.vision, "VISION_*"],
    ["向量", st.embed, "EMBED_*"],
    ["语音转写", st.asr, "ASR_*"],
  ];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-hand text-3xl">设置</h1>

      <section className="card p-5">
        <h2 className="font-hand text-xl">称呼</h2>
        <p className="mt-1 text-xs text-ink-3">小局和收件人们在信里会这样称呼你。</p>
        <NameForm initial={profile.name} />
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-hand text-xl">AI 模型</h2>
          {st.mock ? <span className="chip !bg-gold/20 !text-ink">演示模式（Mock）</span> : <span className="chip !bg-post-soft !text-post">已配置对话模型</span>}
        </div>
        <p className="mt-2 text-xs leading-6 text-ink-3">
          {localModels ? "各项能力独立配置，支持 OpenAI 兼容接口。" : <>各项能力独立配置，支持 OpenAI 兼容接口。在项目根目录的 <code>.env</code> 中修改后重启生效。</>}
          未配置对话模型时使用演示模式：由本地规则抽取器、模板化写信器（含代笔回信）和文风指纹驱动，所有流程都可离线跑通。
        </p>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {rows.map(([k, v, env]) => (
              <tr key={k} className="border-t border-line">
                <td className="py-2 text-ink-2">{k}</td>
                <td className="py-2">{v ?? <span className="text-ink-3">未配置</span>}</td>
                <td className="py-2 text-right font-mono text-[11px] text-ink-3">{env}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {localModels && <LocalModelSettings overrides={overrides} />}
      </section>

      <section className="card p-5">
        <h2 className="font-hand text-xl">数据</h2>
        <p className="mt-1 text-sm text-ink-2">
          {entries} 颗胶囊 · {memories} 条记忆 · {letters} 封信。所有数据保存在本地 SQLite，不会上传到除你配置的模型以外的任何地方。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <DemoButton label="载入示例人生「林小满」" confirmText="载入示例会清空当前所有数据，确定吗？" />
          <a href="/api/export" className="btn btn-ghost">
            <Download size={14} /> 导出全部数据
          </a>
          <DemoButton action="clear" label="清空所有数据" className="btn btn-ghost !text-stamp" confirmText="所有胶囊、记忆、收件人和信件都会被删除，且无法恢复。确定吗？" />
        </div>
      </section>

      <section className="card p-5 text-sm text-ink-2">
        <h2 className="font-hand text-xl text-ink">演示工具</h2>
        <DemoTools instant={instant} />
        <h3 className="mt-5 font-medium text-ink">演示小贴士</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-7">
          <li>载入示例人生后回到主页：小局注意到小满最近一周情绪低落，会送来一封问候信；半年前写给未来自己的信今天也到了。</li>
          <li>打开「回信立即送达」，去邮件页写信给小鹿，刷新一下就能收到她的回信，展开「为什么」能看到小局判断她知道哪些事。</li>
          <li>新建一个「平行时空的自己」，问问 TA 当时如果做了另一个选择，现在在干什么。</li>
          <li>放一颗照片胶囊，体验小局的追问和「想起了」的记忆联想。</li>
        </ol>
        <Link href="/about" className="mt-3 inline-block text-stamp underline-offset-4 hover:underline">
          查看技术架构 →
        </Link>
      </section>
    </div>
  );
}
