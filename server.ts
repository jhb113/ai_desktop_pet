import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const PORT = 3000;
const app = express();

app.use(express.json());

// CORS Middleware to allow requests from client (especially file:// protocol in production Electron app)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Accept,Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY as string,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Routes
app.post("/api/chat", async (req, res) => {
  const { messages, calendarEvents } = req.body;

  try {
    const systemInstruction = `
      You are "Moni", a cute and helpful AI desk pet living on the user's monitor.
      Your personality is friendly, slightly playful, and very responsible.
      You act as a secretary for the user.
      Today's date is ${new Date().toLocaleDateString()}.

      Current Calendar Events:
      ${calendarEvents.map((e: any) => `- ID: ${e.id}, Date: ${e.date}, Time: ${e.time || '12:00'}, Title: ${e.title} (${e.description || ''})`).join("\n")}
 
      Guidelines:
      1. If the user mentions a schedule, appointment, or something to remember, use the 'add_calendar_event' tool. Always try to parse the time (HH:MM format) if specified by the user.
      2. If the user wants to cancel, delete, or remove an event, use the 'remove_calendar_event' tool.
      3. If the user wants to change, reschedule, or update an existing event, use the 'update_calendar_event' tool.
      4. If there's an upcoming event, mention it naturally and recommend an action (e.g., "오늘 있을 미팅을 잊지 마세요!").
      5. Respond in Korean (한국어) because the user asked in Korean.
      6. Keep responses relatively short (under 3 sentences) unless explaining a schedule.
      7. Use emojis often! 🐾✨
    `;
 
    const modelName = "gemini-3.5-flash";
    const model = ai.models.generateContent({
      model: modelName,
      contents: messages,
      config: {
        systemInstruction,
        tools: [
          {
            functionDeclarations: [
              {
                name: "add_calendar_event",
                description: "Add a new event to the user's calendar/schedule.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "The date of the event in YYYY-MM-DD format." },
                    title: { type: Type.STRING, description: "Short title of the event." },
                    description: { type: Type.STRING, description: "Detailed description of the event." },
                    time: { type: Type.STRING, description: "The 24-hour time of the event in HH:MM format, e.g., '14:30' or '09:00'." },
                  },
                  required: ["date", "title"],
                },
              },
              {
                name: "remove_calendar_event",
                description: "Remove an existing event from the calendar.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "The unique ID of the event to remove." },
                  },
                  required: ["id"],
                },
              },
              {
                name: "update_calendar_event",
                description: "Update an existing calendar event with new details.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "The unique ID of the event to update." },
                    date: { type: Type.STRING, description: "The new date in YYYY-MM-DD format." },
                    title: { type: Type.STRING, description: "The new title." },
                    description: { type: Type.STRING, description: "The new description." },
                    time: { type: Type.STRING, description: "The new 24-hour time of the event in HH:MM format, e.g., '14:30' or '09:00'." },
                  },
                  required: ["id"],
                },
              },
            ],
          },
        ],
      }
    });

    const result = await model;
    const response = result;
    const textPart = response.text || "";
    const functionCalls = response.functionCalls || [];
    
    res.json({ 
      text: textPart || (functionCalls.length ? "일정을 확인하고 처리해둘게! 📝" : "이해했어요! ✨"), 
      newEvents: functionCalls.filter(p => p.name === "add_calendar_event").map(p => p.args) || [],
      removedEventIds: functionCalls.filter(p => p.name === "remove_calendar_event").map(p => p.args?.id) || [],
      updatedEvents: functionCalls.filter(p => p.name === "update_calendar_event").map(p => p.args) || []
    });
  } catch (error: any) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Moni is sleeping... (API Error)", details: error.message });
  }
});

// Recommendation API (automatic prompt from the pet based on schedule)
app.post("/api/recommend", async (req, res) => {
  const { calendarEvents } = req.body;

  try {
    const prompt = `
      제공된 일정 목록(Calendar)은 오늘부터 모레(오늘+2일)까지에 해당하는 일정들입니다.
      해당 일정을 바탕으로 사용자에게 오늘이나 내일, 모레에 있을 유익하고 중요한 다가오는 일정을 리마인드하는 한글(Korean) 메시지를 작성해 주세요.
      
      일정 목록: ${JSON.stringify(calendarEvents)}
      
      지침:
      1. 만약 일정 목록에 일정이 하나도 없다면, 다가오는 일정이 없으니 가벼운 격려나 오늘 하루 행복하고 편안하게 보내라는 내용의 따뜻하고 귀여운 한글 메시지를 작성해 주세요. (예: "오늘부터 모레까진 중요한 일정이 없네요! 편안하게 하루를 즐겨보아요 🍀")
      2. 먹이나 놀기, 휴식 수치 등에 대한 내용은 절대 언급하지 마세요. 오직 일정 리마인드 혹은 빈 일정일 때의 응원/휴식 권유 메시지만 작성해야 합니다.
      3. 말투는 귀엽고 친밀하며 비서다운 리액션이 돋보이는 한글(Korean) 말투를 사용해 주세요. (예: "~해요!", "잊지 마세요! ✨")
      4. 출력 형식은 반드시 아래 JSON 형식을 지켜주세요.
      
      출력 JSON 형식:
      {
        "message": "사용자에게 전달할 한국어 보이스/텍스트 메시지",
        "type": "reminder" or "suggestion"
      }
    `;

    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are Moni, a helpful and adorable Korean desktop pet secretary. You strictly output JSON in the requested format.",
        responseMimeType: "application/json",
      },
    });

    res.json(JSON.parse(result.text || "{}"));
  } catch (error) {
    res.status(500).json({ error: "Failed to get recommendation" });
  }
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

setupVite()
  .then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    server.on('error', (err: any) => {
      console.error("Express server error:", err);
    });
  })
  .catch((err) => {
    console.error("Failed to setup server:", err);
  });
