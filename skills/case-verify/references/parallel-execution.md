# 执行策略与并行边界

开始浏览器执行前必须给用户推荐并让用户选择：
- swarm_recommended：数量较多、read-only/隔离数据多、group可分且收益明显；
- single_agent_recommended：可并行但共享上下文/登录/mock切换使收益低；
- single_only：共享写数据、破坏性操作、全局登录或单实例mock强冲突，不能安全并发。

展示trail/checkpoint数量、2–3条推荐证据、写数据/mock/profile风险。非single_only提供swarm与单agent两个选项；single_only说明原因并确认开始。不得先跑再补选择。

单agent按parallel_group顺序逐trail加载。group只表示顺序，不能直接当并发许可。swarm按conflicts_with、写域、mock场景及独立profile拆分；每个worker只拿自己的trail、确认的oracle引用、必要URL/login/mock、固定expected_plan_rev。不要派发整个仓库上下文，不让两人编辑同一计划。

观察共同写入observe.py，锁覆盖校验/分配id/追加；不要让worker直接echo JSONL。相同确认版本内结果保守聚合，复测需要明确supersede。父agent不重标迟到worker结果。

重新freeze/confirm之前停止全部执行worker并等待退出；旧队列结果仍可能迟到，因此revision fence不可省略。报告列实际策略、每人trail、冲突隔离和限制。用户没授权多agent时不自发创建团队。
