import Link from "next/link";
import { Download } from "lucide-react";
import { diagnostics } from "@/lib/diagnostics";
import { getProfile } from "@/lib/memory/profile";
import { DemoButton } from "@/components/DemoButton";
import { NameForm } from "@/components/NameForm";
import { DiagnosticsPanel } from "@/components/settings/DiagnosticsPanel";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";

export default async function Settings() {
  const profile = await getProfile();
  const [entries, memories, letters, diag] = await Promise.all([db.entry.count(), db.memory.count({ where: ACTIVE_MEMORY }), db.letter.count(), diagnostics()]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-hand text-3xl">设置</h1>

      <section className="card p-5">
        <h2 className="font-hand text-xl">称呼</h2>
        <NameForm initial={profile.name} />
      </section>

      <DiagnosticsPanel initial={diag} />

      <section className="card p-5">
        <h2 className="font-hand text-xl">数据</h2>
        <p className="mt-1 text-sm text-ink-2">
          {entries} 条记录 · {memories} 条记忆 · {letters} 封信。所有数据保存在本地 SQLite，不会上传到除你配置的模型以外的任何地方。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <DemoButton label="载入示例人生「林小满」" confirmText="载入示例会清空当前所有数据，确定吗？" />
          <a href="/api/export" className="btn btn-ghost">
            <Download size={14} /> 导出全部数据
          </a>
          <DemoButton action="clear" label="清空所有数据" className="btn btn-ghost !text-stamp" confirmText="所有记录、记忆和信件都会被删除，且无法恢复。确定吗？" />
        </div>
      </section>

      <section className="card p-5 text-sm text-ink-2">
        <h2 className="font-hand text-xl text-ink">演示小贴士</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-7">
          <li>载入示例人生后回到首页，邮差会注意到最近一周情绪低落，送来一封「未来的你」的信。</li>
          <li>点右上角日期打开时光机，快进 7 天：大理旅行满三个月、认证考试到期、半年前的时间胶囊都会送达。</li>
          <li>寄一张照片，体验 AI 追问与「想起了」的记忆联想。</li>
        </ol>
        <Link href="/about" className="mt-3 inline-block text-stamp underline-offset-4 hover:underline">
          查看技术架构 →
        </Link>
      </section>
    </div>
  );
}
