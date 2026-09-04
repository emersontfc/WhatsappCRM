import axios from "axios";

async function main() {
  try {
    const res = await axios.post("http://localhost:3000/api/agent/chat", {
      message: "Qual o status do funil de vendas?"
    }, {
      headers: {
        "x-user-id": "9744c780-39bd-48df-9a84-acaf4dec34a9"
      }
    });
    console.log("Web Copilot Response:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("Error:", err.response?.data || err.message);
  }
}

main();
