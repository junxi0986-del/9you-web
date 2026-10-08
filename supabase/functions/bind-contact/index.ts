// [需求二/需求四] bind-contact：免短信/邮件验证，直接为当前登录用户绑定或修改手机号 / 邮箱
// 安全模型：
//   1. 必须携带调用者 JWT（sb.functions.invoke 自动附带），用 anon client getUser 校验，且只能改自己
//   2. 真正写入由 service_role 的 Admin API 完成（phone_confirm / email_confirm 直接置为已确认）
//   3. service_role 仅存在于函数环境变量，不暴露给前端
// [修复] 不用 admin.updateUserById（其失败时只抛笼统的 "Error updating user"），
//        改为原生 HTTP 调 GoTrue Admin 接口，完整透传底层状态码与 msg
// [30天限制] 设置页修改手机号/邮箱每 30 天一次：上次修改时间写入 user_metadata，
//        服务端强制拦截（换设备/清缓存均绕不过）；首次绑定（原值为空）不受此限
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const META_KEY: Record<"phone" | "email", string> = {
  phone: "jy_last_phone_change",
  email: "jy_last_email_change",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// GoTrue 常见错误 msg → 中文
function zh(kind: "phone" | "email", rawMsg: string, status: number): string {
  const label = kind === "phone" ? "手机号" : "邮箱";
  const m = (rawMsg || "").toLowerCase();
  if (m.includes("already") && m.includes("registered")) return `该${label}已被其他账号使用`;
  if (m.includes("already") && m.includes("used")) return `该${label}已被其他账号使用`;
  if (m.includes("exists")) return `该${label}已被其他账号使用`;
  if (m.includes("duplicate")) return `该${label}已被其他账号使用`;
  if (m.includes("same")) return `新${label}与当前${label}相同，无需修改`;
  if (m.includes("invalid")) return `${label}格式无效`;
  if (m.includes("rate") || m.includes("too many")) return "操作过于频繁，请稍后再试";
  if (m.includes("sms") || m.includes("send")) return "短信通道暂时异常，请稍后重试";
  return `写入失败（HTTP ${status}）：${rawMsg || "未知错误"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "仅支持 POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "未登录" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "服务配置缺失" }, 500);

    // 以调用者身份校验 JWT，拿到其 uid
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await caller.auth.getUser();
    if (uerr || !user) return json({ error: "登录态无效，请重新登录" }, 401);

    let payload: { kind?: unknown; value?: unknown; current?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "请求格式错误" }, 400);
    }

    // 组装 GoTrue Admin 更新参数，并提前拦截「新旧值相同」
    const update: Record<string, unknown> = {};
    let kind: "phone" | "email";
    let newValue = "";

    if (payload.kind === "phone") {
      const value = String(payload.value || "");
      if (!/^\+861[3-9]\d{9}$/.test(value)) return json({ error: "手机号格式不正确" }, 400);
      kind = "phone";
      newValue = value;
      if (user.phone === value) return json({ error: "新手机号与当前手机号相同，无需修改" }, 400);
      update.phone = value;
      update.phone_confirm = true;
    } else if (payload.kind === "email") {
      const value = String(payload.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return json({ error: "邮箱格式不正确" }, 400);
      kind = "email";
      newValue = value;
      if ((user.email || "").toLowerCase() === value) {
        return json({ error: "新邮箱与当前邮箱相同，无需修改" }, 400);
      }
      update.email = value;
      update.email_confirm = true;
    } else {
      return json({ error: "类型错误" }, 400);
    }

    // [30天限制] 仅「修改」受限：原值非空即为修改；首次绑定（原值为空）直接放行
    const oldValue = kind === "phone" ? (user.phone || "") : (user.email || "");
    const metaKey = META_KEY[kind];
    const existingMeta: Record<string, unknown> = { ...(user.user_metadata || {}) };

    if (oldValue) {
      // [身份验证] 修改必须携带 current 且与当前值完全一致（防绕过前端直接调接口）
      const provided =
        kind === "phone"
          ? String(payload.current || "")
          : String(payload.current || "").trim().toLowerCase();
      const expect = kind === "phone" ? oldValue : oldValue.toLowerCase();
      const label = kind === "phone" ? "手机号" : "邮箱";
      if (provided !== expect) {
        return json({ error: `身份验证失败：当前${label}不正确` }, 403);
      }

      const lastIso = existingMeta[metaKey];
      const lastTs = lastIso ? Date.parse(String(lastIso)) : NaN;
      if (!isNaN(lastTs)) {
        const elapsed = Date.now() - lastTs;
        if (elapsed < COOLDOWN_MS) {
          const remainMs = COOLDOWN_MS - elapsed;
          const days = Math.ceil(remainMs / (24 * 60 * 60 * 1000));
          const nextDate = new Date(lastTs + COOLDOWN_MS);
          const md = `${nextDate.getMonth() + 1}月${nextDate.getDate()}日`;
          const label = kind === "phone" ? "手机号" : "邮箱";
          return json(
            { error: `${label}每30天只能修改一次，还剩${days}天（${md}可再次修改）` },
            403,
          );
        }
      }
      // 通过冷却校验：记录本次修改时间（随 PUT 一起写入）
      existingMeta[metaKey] = new Date().toISOString();
      update.user_metadata = existingMeta;
    }

    // 原生 PUT /auth/v1/admin/users/{uid}（service_role），完整读取底层错误
    const adminUrl = `${url}/auth/v1/admin/users/${user.id}`;
    console.log(`[bind-contact] uid=${user.id} kind=${kind} value=${newValue}`);
    const r = await fetch(adminUrl, {
      method: "PUT",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch {}
    console.log(`[bind-contact] GoTrue status=${r.status} body=${text.slice(0, 500)}`);

    if (!r.ok) {
      const rawMsg = body?.msg || body?.error_description || body?.message || text;
      return json({ error: zh(kind, rawMsg, r.status), raw: rawMsg, http: r.status }, 400);
    }
    return json({ ok: true, phone: body?.phone ?? null, email: body?.email ?? null });
  } catch (e) {
    console.error("[bind-contact] 异常:", e);
    return json({ error: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
