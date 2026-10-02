// SDK errors may contain provider bodies or authorization URLs. Only classified diagnostics leave the backend.
export function modelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
  if (/<!doctype|<html|Just a moment|cf-mitigated|Cloudflare challenge/i.test(message)) return "网络网关拦截了后端请求，尚未完成令牌交换；请检查模型代理。浏览器回调成功不代表模型已接入。";
  if (/fetch failed|timeout|ECONN|ENOTFOUND|network|proxy/i.test(`${message} ${code ?? ""}`)) return "后端连接服务商失败。请检查模型代理、网络和超时设置，再重新授权或验证。";
  if (/scope|permission|eligible|403|forbidden|sharing.*unavailable/i.test(message)) return "服务商未允许此账号使用所选模型或订阅共享。请确认订阅权限，或换用账号可访问的模型。";
  if (/401|invalid_grant|unauthorized|expired|refresh/i.test(message)) return "登录凭据失效或授权码已使用。请重新授权；不要重复提交旧回调链接。";
  if (/429|quota|usage.limit|rate.limit/i.test(message)) return "服务商额度或速率限制已触发，请稍后重试或更换有额度的账号。";
  if (/budget/i.test(message)) return "本站模型调用预算已达到上限，请检查后台预算。";
  if (/state|callback|authorization code/i.test(message)) return "回调链接与当前登录不匹配。请使用当前授权页返回的完整链接，或重新登录。";
  if (/abort|cancel/i.test(message)) return "登录或请求已取消，请重新开始。";
  if (/accountId|ID token/i.test(message)) return "服务商令牌格式与当前登录方式不兼容，请换用对应的 ChatGPT 登录入口。";
  return "服务商请求未完成。请检查登录方式、所选模型和账号权限后重试。";
}
