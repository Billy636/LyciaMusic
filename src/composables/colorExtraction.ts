// 增强的颜色提取逻辑：支持颜色分组与差异化选择
export async function extractDominantColors(imageUrl: string, count: number = 4): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(['#4c1d95', '#8b5cf6', '#c4b5fd', '#312e81']);
        return;
      }

      // 缩小图片以加快处理速度
      canvas.width = 40;
      canvas.height = 40;
      ctx.drawImage(img, 0, 0, 40, 40);

      const imageData = ctx.getImageData(0, 0, 40, 40).data;
      const colors: {r: number, g: number, b: number}[] = [];

      for (let i = 0; i < imageData.length; i += 4 * 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        
        // 过滤掉极端颜色（过亮或过暗）
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness < 30 || brightness > 230) continue;

        colors.push({r, g, b});
      }

      if (colors.length === 0) {
        resolve(['#5b21b6', '#7c3aed', '#a78bfa', '#4c1d95']);
        return;
      }

      // 简单的聚类：如果颜色太接近，则视为同一种
      const uniqueColors: {r: number, g: number, b: number, count: number}[] = [];
      const threshold = 40; // 颜色差异阈值

      colors.forEach(c => {
        let found = false;
        for (const uc of uniqueColors) {
          const diff = Math.sqrt(
            Math.pow(c.r - uc.r, 2) + 
            Math.pow(c.g - uc.g, 2) + 
            Math.pow(c.b - uc.b, 2)
          );
          if (diff < threshold) {
            uc.count++;
            found = true;
            break;
          }
        }
        if (!found) {
          uniqueColors.push({...c, count: 1});
        }
      });

      // 按出现次数排序
      const sorted = uniqueColors.sort((a, b) => b.count - a.count);
      
      // 🟢 核心优化：将颜色转换为 HSL 并调整明度/饱和度 (Pastel 效果)
      const processColor = (r: number, g: number, b: number) => {
        let r_norm = r / 255, g_norm = g / 255, b_norm = b / 255;
        const max = Math.max(r_norm, g_norm, b_norm), min = Math.min(r_norm, g_norm, b_norm);
        let h = 0, s, l = (max + min) / 2;

        if (max === min) {
          h = s = 0;
        } else {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === r_norm) h = (g_norm - b_norm) / d + (g_norm < b_norm ? 6 : 0);
          else if (max === g_norm) h = (b_norm - r_norm) / d + 2;
          else h = (r_norm - g_norm) / d + 4;
          h /= 6;
        }

        // 强行清洗颜色：执行更激进的“淡水彩”约束
        // 1. 极高明度 (80% - 95%) -> 几乎接近白色
        // 2. 极低饱和度 (20% - 40%) -> 极淡的色偏
        const finalH = Math.round(h * 360);
        const finalS = Math.round(Math.max(20, Math.min(40, s * 100)));
        const finalL = Math.round(Math.max(80, Math.min(95, l * 100)));

        return `hsl(${finalH}, ${finalS}%, ${finalL}%)`;
      };

      let result = sorted.slice(0, count).map(c => processColor(c.r, c.g, c.b));

      // 兜底逻辑：如果提取到的颜色不足，则进行微调生成辅助色
      if (result.length < count) {
        const base = sorted[0] || {r: 91, g: 33, b: 182};
        while (result.length < count) {
          const shift = (result.length + 1) * 30;
          result.push(processColor(
            Math.max(0, Math.min(255, base.r - shift)),
            Math.max(0, Math.min(255, base.g + shift)),
            Math.max(0, Math.min(255, base.b + 20))
          ));
        }
      }

      resolve(result);
    };

    img.onerror = () => {
      resolve(['#5b21b6', '#7c3aed', '#a78bfa', '#4c1d95']);
    };
  });
}