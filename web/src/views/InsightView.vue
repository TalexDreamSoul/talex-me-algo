<script setup>
import { computed } from 'vue';
import { TxCard } from '@talex-touch/tuffex/card';
import { TxFlex } from '@talex-touch/tuffex/flex';
import { TxStack } from '@talex-touch/tuffex/stack';
import { TxAllocationBar } from '@talex-touch/tuffex/allocation-bar';
import { TxProgressBar } from '@talex-touch/tuffex/progress-bar';
import { TxSparkChart } from '@talex-touch/tuffex/spark-chart';
import { TxTag } from '@talex-touch/tuffex/tag';
import { TxEmptyState } from '@talex-touch/tuffex/empty-state';

const props = defineProps({ data: { type: Object, required: true } });

const started = computed(() => props.data.problems.filter((p) => p.started));

/** 难度分布：用 AllocationBar 表达三档的占比 */
const diffSegments = computed(() => {
  const order = [
    { key: 'Easy', label: '简单', color: 'var(--tx-color-success)' },
    { key: 'Medium', label: '中等', color: 'var(--tx-color-warning)' },
    { key: 'Hard', label: '困难', color: 'var(--tx-color-danger)' },
  ];
  const total = started.value.length || 1;
  return order.map((o) => {
    const n = started.value.filter((p) => p.difficulty === o.key).length;
    const mastered = started.value.filter(
      (p) => p.difficulty === o.key && p.status === 'mastered',
    ).length;
    return {
      key: o.key,
      label: o.label,
      short: o.key.slice(0, 1),
      percent: Math.round((n / total) * 100),
      amount: `${n} 题`,
      color: o.color,
      description: `已做 ${n} 题，其中 ${mastered} 题达到掌握。`,
    };
  });
});

/** 分类覆盖率，按缺口从大到小排 —— 直接告诉你哪块最欠 */
const topicGaps = computed(() => {
  const nameOf = Object.fromEntries(props.data.topics.map((t) => [t.slug, t.name]));
  const map = new Map();
  for (const p of props.data.problems) {
    if (!map.has(p.topic)) map.set(p.topic, { total: 0, done: 0, mastered: 0 });
    const g = map.get(p.topic);
    g.total++;
    if (p.started) g.done++;
    if (p.status === 'mastered') g.mastered++;
  }
  return [...map]
    .map(([slug, g]) => ({
      slug,
      name: nameOf[slug] ?? slug,
      ...g,
      percent: Math.round((g.done / g.total) * 100),
    }))
    .sort((a, b) => a.percent - b.percent || b.total - a.total);
});

/** 最近 30 天判题次数。TxSparkChart 要的是 series[{id, data:[{time, value}]}] */
const activitySeries = computed(() => {
  const byDay = Object.fromEntries(props.data.activity.map((a) => [a.day, a.n]));
  const data = [];
  const cur = new Date(props.data.today);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i);
    data.push({
      time: Math.floor(d.getTime() / 1000),
      value: byDay[d.toISOString().slice(0, 10)] ?? 0,
    });
  }
  return [{ id: 'runs', label: '判题次数', data, color: 'var(--tx-color-primary)' }];
});

const totalRuns = computed(() => props.data.activity.reduce((s, a) => s + a.n, 0));
const activeDays = computed(() => props.data.activity.length);

const patterns = computed(() =>
  Object.entries(props.data.patternCounts).sort((a, b) => b[1] - a[1]),
);
const maxPattern = computed(() => Math.max(1, ...patterns.value.map(([, v]) => v)));
</script>

<template>
  <TxFlex :gap="16" wrap align="stretch">
    <TxCard background="mask" style="flex: 1; min-width: 320px; padding: 16px 18px">
      <h3 style="margin: 0 0 4px; font-size: 14px">难度分布</h3>
      <p style="margin: 0 0 14px; font-size: 12px; color: var(--tx-text-color-secondary)">
        已建立的 {{ started.length }} 道题按难度拆分
      </p>
      <TxAllocationBar v-if="started.length" :segments="diffSegments" detail />
      <TxEmptyState
        v-else
        variant="no-data"
        size="small"
        title="还没有题"
        description="跑 algo new <题号> 建第一道。"
      />
    </TxCard>

    <TxCard background="mask" style="flex: 1; min-width: 320px; padding: 16px 18px">
      <h3 style="margin: 0 0 4px; font-size: 14px">近 30 天判题</h3>
      <p style="margin: 0 0 14px; font-size: 12px; color: var(--tx-text-color-secondary)">
        累计 {{ totalRuns }} 次，覆盖 {{ activeDays }} 天
      </p>
      <!-- TxSparkChart 没有 height prop，canvas 撑满父容器，必须由外层定高 -->
      <div style="height: 110px">
        <TxSparkChart :series="activitySeries" grid :grid-lines="3" />
      </div>
    </TxCard>
  </TxFlex>

  <TxCard background="mask" style="padding: 16px 18px">
    <h3 style="margin: 0 0 4px; font-size: 14px">分类缺口</h3>
    <p style="margin: 0 0 14px; font-size: 12px; color: var(--tx-text-color-secondary)">
      覆盖率最低的排在最前 —— 这些是该优先补的
    </p>
    <TxStack direction="vertical" :gap="11">
      <div v-for="g in topicGaps" :key="g.slug">
        <TxFlex :gap="10" align="center">
          <span style="width: 130px; font-size: 13px">{{ g.name }}</span>
          <TxProgressBar
            :percentage="g.percent"
            :show-text="false"
            :color="g.percent === 0 ? 'var(--tx-text-color-secondary)' : undefined"
            style="flex: 1"
          />
          <span
            style="
              width: 74px;
              text-align: right;
              font-size: 12px;
              color: var(--tx-text-color-secondary);
            "
            >{{ g.done }}/{{ g.total }}</span
          >
          <TxTag
            v-if="g.mastered"
            :label="`掌握 ${g.mastered}`"
            color="var(--tx-color-success)"
            variant="soft"
          />
        </TxFlex>
      </div>
    </TxStack>
  </TxCard>

  <TxCard background="mask" style="padding: 16px 18px">
    <h3 style="margin: 0 0 4px; font-size: 14px">模板覆盖</h3>
    <p style="margin: 0 0 14px; font-size: 12px; color: var(--tx-text-color-secondary)">
      来自各题 notes.md 的 pattern 字段。同一模板反复出现说明你在稳固它。
    </p>
    <TxStack v-if="patterns.length" direction="vertical" :gap="9">
      <TxFlex v-for="[name, n] in patterns" :key="name" :gap="10" align="center">
        <span style="width: 170px; font-size: 13px">{{ name }}</span>
        <TxProgressBar
          :percentage="Math.round((n / maxPattern) * 100)"
          :show-text="false"
          style="flex: 1; max-width: 300px"
        />
        <span style="font-size: 12px; color: var(--tx-text-color-secondary)">{{ n }} 题</span>
      </TxFlex>
    </TxStack>
    <TxEmptyState
      v-else
      variant="blank-slate"
      size="small"
      title="还没写过 pattern"
      description="在题目的 notes.md 顶部 frontmatter 里填 pattern，这里就会统计。"
    />
  </TxCard>
</template>
