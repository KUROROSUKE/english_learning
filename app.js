fetch("quiz.json")
  .then(res => {
    if (!res.ok) throw new Error("JSONの読み込みに失敗");
    return res.json();
  })
  .then(quiz => {
    renderQuiz(quiz);
  })
  .catch(err => {
    document.getElementById("app").textContent = err.message;
  });

function renderQuiz(quiz) {
  document.getElementById("title").textContent = quiz.title;

  const app = document.getElementById("app");
  app.innerHTML = "";

  quiz.items.forEach(item => {
    if (item.type === "fill") {
      const div = document.createElement("div");
      div.innerHTML = `
        <p>${item.prompt}</p>
        <input type="text" data-answer="${item.answer}">
      `;
      app.appendChild(div);
    }
  });
}
