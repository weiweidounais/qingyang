# 食物目录来源

仅导入目录，不导入任何用户健康历史。所有数值均为每100g，按契约精度保留1位小数。

数据于2026-10-20从USDA FoodData Central官方API读取、逐项核对：

| FDC ID | 原始名称 | 热量kcal | 碳水g | 蛋白质g | 脂肪g |
| --- | --- | --- | --- | --- | --- |
| 168878 | Rice, white, long-grain, regular, enriched, cooked | 130 | 28.17 | 2.69 | 0.28 |
| 173944 | Bananas, raw | 89 | 22.84 | 1.09 | 0.33 |
| 171477 | Chicken, broilers or fryers, breast, meat only, cooked, roasted | 165 | 0 | 31.02 | 3.57 |
| 171688 | Apples, raw, with skin | 52 | 13.81 | 0.26 | 0.17 |

官方详情地址格式：https://fdc.nal.usda.gov/food-details/168878/nutrients 。这些目录值不是对用户实际餐食的测量。烹调方式和额外配料需要用户自行确认。

接入更大食物目录时应记录来源和许可，经既定seed流程导入。不得从模型补造目录事实。
