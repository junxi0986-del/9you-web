// Send SMS Hook：Supabase Auth 触发 → 后台异步经阿里云 dypnsapi 发送短信验证码
// 部署要求：verify_jwt = false（GoTrue 服务端调用，不带用户 JWT；由 Hook 签名保证来源可信）
// [修复1] Hook payload 中 user.phone 为 E.164（+86138...），阿里云国内短信需要 11 位裸号（138...）
// [修复2] 可选验签：配置了 SEND_SMS_HOOK_SECRET 时用 Standard Webhooks 校验请求确来自 Supabase
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// 【配置区】
const SIGN_NAME = "恒锐创岳科技";      // 赠送签名
const TEMPLATE_CODE = "100001";       // 登录/注册模板
const VALID_MINUTES = "5";

/* ---------- 阿里云 RPC 签名（HMAC-SHA1） ---------- */
async function aliyunRpcRequest(
  action: string,
  bizParams: Record<string, string>,
  akId: string,
  akSecret: string,
) {
  const commonParams: Record<string, string> = {
    AccessKeyId: akId,
    Action: action,
    Format: "JSON",
    RegionId: "cn-hangzhou",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };

  const allParams = { ...commonParams, ...bizParams };
  const sortedKeys = Object.keys(allParams).sort();

  const pe = (s: string) =>
    encodeURIComponent(s)
      .replace(/\+/g, "%20")
      .replace(/\*/g, "%2A")
      .replace(/%7E/g, "~");

  const canonicalizedQuery = sortedKeys
    .map((k) => `${pe(k)}=${pe(allParams[k])}`)
    .join("&");

  const stringToSign = `GET&${pe("/")}&${pe(canonicalizedQuery)}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(akSecret + "&"),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stringToSign),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const url = `https://dypnsapi.aliyuncs.com/?${canonicalizedQuery}&Signature=${pe(signature)}`;

  const resp = await fetch(url);
  return await resp.json();
}

/* ---------- [修复1] E.164 → 阿里云 11 位裸号：+8613812345678 → 13812345678 ---------- */
function toAliyunPhone(e164: unknown): string {
  return String(e164 || "").replace(/^\+?86/, "").replace(/\D/g, "").slice(0, 11);
}

/* ---------- 后台异步发送（不阻塞 Supabase Hook 响应） ---------- */
async function sendSmsInBackground(phone: string, code: string) {
  try {
    const akId = Deno.env.get("ALIYUN_AK_ID")!;
    const akSecret = Deno.env.get("ALIYUN_AK_SECRET")!;

    console.log("[SMS 后台] 开始发送, phone:", phone, "otp:", code);

    // [修复3] 参数名必须是 TemplateParam（非 TerminateParam）；模板 100001 含 ${code}、${min} 两个变量
    // 验证码由 GoTrue 生成、Supabase 负责校验，因此直接传具体值，阿里云原样下发（不用 ##code##）
    const result = await aliyunRpcRequest(
      "SendSmsVerifyCode",
      {
        PhoneNumber: phone,
        SignName: SIGN_NAME,
        TemplateCode: TEMPLATE_CODE,
        TemplateParam: JSON.stringify({ code, min: VALID_MINUTES }),
      },
      akId,
      akSecret,
    );

    console.log("[SMS 后台] 阿里云返回:", JSON.stringify(result));

    if (result.Code !== "OK") {
      console.error("[SMS 后台] 发送失败:", result.Message);
    } else {
      console.log("[SMS 后台] 发送成功, bizId:", result.Model?.BizId);
    }
  } catch (e) {
    console.error("[SMS 后台] 异常:", e);
  }
}

/* ---------- 主入口：立即返回 200，后台异步发短信 ---------- */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok");

    // [修复2] 可选验签：仅当配置了 SEND_SMS_HOOK_SECRET 时启用（Standard Webhooks）
    const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
    const rawBody = await req.text();
    let parsed: any = null;

    if (hookSecret) {
      try {
        const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));
        parsed = wh.verify(rawBody, Object.fromEntries(req.headers));
      } catch (e) {
        console.error("[SMS Hook] 签名校验失败:", e);
        return new Response(JSON.stringify({ error: "非法请求" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      parsed = JSON.parse(rawBody);
    }

    const e164 = parsed?.user?.phone;
    const phone = toAliyunPhone(e164);   // [修复1] 去掉 +86 国家码
    const code = parsed?.sms?.otp;

    console.log("[SMS Hook] 收到请求 e164:", e164, "→ 阿里云 phone:", phone, "otp:", code);

    if (!phone || !code) {
      return new Response(JSON.stringify({ error: "缺少 phone 或 otp" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return new Response(JSON.stringify({ error: `手机号格式错误：${e164}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 关键：waitUntil — 先返回 200，后台继续发短信
    // @ts-ignore — EdgeRuntime 是 Supabase 特有的全局对象
    EdgeRuntime.waitUntil(sendSmsInBackground(phone, code));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[SMS Hook] 入口异常:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
