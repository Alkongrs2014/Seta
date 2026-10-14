/* =====================================================================
   النشاط الحيّ للفرص النشطة: يُحسب من بيانات السوق المخزّنة في الذاكرة
   (شموع 15د المغلقة + ticker) ويُحفظ منفصلاً في جدول activity_now.
   بيانات الفرصة وقت إصدارها (data / activity) لا تُمسّ أبداً.
   ===================================================================== */
import { atr } from "./strategy.js";

const r2 = x => Math.round(x * 100) / 100;

/* RVOL = آخر شمعة 15د مغلقة (بالدولار) ÷ متوسط الشموع السابقة */
export function rvolNow(closed, lookback = 20) {
  if (!closed || closed.length < lookback + 1) return null;
  const last = closed[closed.length - 1];
  const prev = closed.slice(-1 - lookback, -1);
  const base = prev.reduce((a, c) => a + (c.q || 0), 0) / prev.length;
  return base > 0 && last.q != null ? r2(last.q / base) : null;
}

/* ATR%(15د) على آخر 14 شمعة مغلقة */
export function atrPctNow(closed, n = 14) {
  if (!closed || !closed.length) return null;
  const a = atr(closed, n), last = closed[closed.length - 1];
  return a && last.c ? Math.round(a / last.c * 10000) / 100 : null;
}

export function spreadOf(bid, ask) {
  if (!(bid > 0 && ask > 0)) return null;
  const mid = (bid + ask) / 2;
  return Math.round((ask - bid) / mid * 100000) / 1000;
}
