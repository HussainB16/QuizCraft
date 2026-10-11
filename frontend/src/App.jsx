
import { useState } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function App() {
  const [mode, setMode] = useState("login");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [documentTitle, setDocumentTitle] = useState("");
  const [studyMaterial, setStudyMaterial] = useState(null);

  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function request(url, options = {}) {
    const response = await fetch(`${API}${url}`, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : `Request failed (${response.status}). Please try again.`
      );
    }

    return data;
  }

  function clearMessages() {
    setMessage("");
    setError("");
  }

  async function handleAuth(event) {
    event.preventDefault();
    clearMessages();
    setLoading(true);

    try {
      const registering = mode === "register";
      const data = await request(
        registering ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            registering ? { name, email, password } : { email, password }
          ),
        }
      );

      if (registering) {
        setMode("login");
        setPassword("");
        setMessage("Account created successfully. Please log in.");
      } else {
        setToken(data.access_token);
        setStudyMaterial(null);
        setDocumentId(null);
        setMessage("Welcome back! You're logged in.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(event) {
    event.preventDefault();
    clearMessages();

    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }

    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Please choose a PDF file.");
      return;
    }

    setLoading(true);
    setStudyMaterial(null);
    setAnswers({});
    setSubmitted(false);
    setDocumentId(null);
    setDocumentTitle("");

    try {
      setMessage("Uploading PDF...");

      const formData = new FormData();
      formData.append("file", file);

      const uploaded = await request("/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      setDocumentId(uploaded.id);
      setDocumentTitle(uploaded.title || file.name);
      setMessage("PDF uploaded. Gemini is preparing your study material...");

      const generated = await request(
        `/documents/${uploaded.id}/generate`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setStudyMaterial(generated.study_material);
      setDocumentId(generated.document_id);
      setDocumentTitle(generated.title || uploaded.title || file.name);
      setMessage("Your study material is ready!");
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedMaterial() {
    if (!documentId) {
      setError("Upload a document first.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const data = await request(
        `/documents/${documentId}/study-material`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setStudyMaterial(data.study_material);
      setDocumentTitle(data.title || "Saved study material");
      setAnswers({});
      setSubmitted(false);
      setMessage("Saved study material loaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function selectAnswer(questionIndex, optionIndex) {
    if (submitted) return;

    setAnswers((previous) => ({
      ...previous,
      [questionIndex]: optionIndex,
    }));
  }

  function submitQuiz(event) {
    event.preventDefault();

    const questions = studyMaterial?.questions || [];

    if (Object.keys(answers).length !== questions.length) {
      setError("Please answer every question before submitting.");
      return;
    }

    clearMessages();
    setSubmitted(true);
    setMessage("Quiz submitted. Check your results below.");
  }

  function retryQuiz() {
    setAnswers({});
    setSubmitted(false);
    clearMessages();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function logout() {
    setToken("");
    setPassword("");
    setFile(null);
    setDocumentId(null);
    setDocumentTitle("");
    setStudyMaterial(null);
    setAnswers({});
    setSubmitted(false);
    clearMessages();
    setMessage("You've logged out.");
  }

  const questions = studyMaterial?.questions || [];
  const score = questions.reduce(
    (total, question, index) =>
      total + (answers[index] === question.correct_answer ? 1 : 0),
    0
  );

  const answeredCount = Object.keys(answers).length;

  return (
    <div className="app">
      <header className="header">
        <a
          className="brand"
          href="#top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <span className="brand-mark">Q</span>
          <span>Quiz Craft</span>
        </a>

        <div className="header-right">
          <span className="header-caption">AI-powered learning</span>
          {token && (
            <button className="button button-outline button-small" onClick={logout}>
              Log out
            </button>
          )}
        </div>
      </header>

      <main className="main" id="top">
        {!token ? (
          <section className="auth-card card">
            <div className="eyebrow">YOUR PERSONAL STUDY ASSISTANT</div>
            <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
            <p className="muted">
              {mode === "login"
                ? "Log in to turn your notes into a study guide."
                : "Create an account to get started with Quiz Craft."}
            </p>

            <form className="auth-form" onSubmit={handleAuth}>
              {mode === "register" && (
                <label className="field">
                  Full name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    maxLength={100}
                    required
                  />
                </label>
              )}

              <label className="field">
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="field">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    mode === "register" ? "At least 8 characters" : "Your password"
                  }
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  minLength={mode === "register" ? 8 : undefined}
                  maxLength={128}
                  required
                />
              </label>

              <button className="button button-primary button-full" disabled={loading}>
                {loading
                  ? "Please wait..."
                  : mode === "login"
                    ? "Log in"
                    : "Create account"}
              </button>
            </form>

            <p className="auth-switch">
              {mode === "login" ? "New to Quiz Craft?" : "Already have an account?"}
              {" "}
              <button
                className="link-button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  clearMessages();
                }}
              >
                {mode === "login" ? "Create account" : "Log in"}
              </button>
            </p>
          </section>
        ) : (
          <>
            <section className="hero">
              <div className="eyebrow">LEARN SMARTER, NOT LONGER</div>
              <h1>Turn your notes into knowledge.</h1>
              <p>
                Upload a PDF, get a clear summary, and test what you've learned
                with an AI-generated quiz.
              </p>
            </section>

            <section className="card upload-card">
              <div className="section-heading">
                <div>
                  <span className="step-label">STEP 1</span>
                  <h2>Upload your study material</h2>
                  <p className="muted">
                    Choose a text-based PDF to create your study guide.
                  </p>
                </div>
                <span className="heading-icon">↑</span>
              </div>

              <form onSubmit={handleGenerate}>
                <label className="file-drop">
                  <span className="file-icon">PDF</span>
                  <strong>{file ? file.name : "Choose a PDF from your computer"}</strong>
                  <span className="muted">
                    {file
                      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB selected`
                      : "PDF files only · Maximum 10 MB"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] || null);
                      clearMessages();
                    }}
                  />
                </label>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={loading || !file}
                >
                  {loading ? "Processing..." : "Upload and generate study guide"}
                </button>
              </form>

              {documentId && (
                <button
                  className="button button-outline saved-button"
                  onClick={loadSavedMaterial}
                  disabled={loading}
                >
                  Load saved study material
                </button>
              )}
            </section>

            {studyMaterial && (
              <section className="study-area">
                <div className="study-title">
                  <div>
                    <span className="step-label">YOUR STUDY GUIDE</span>
                    <h2>{documentTitle || "Study material"}</h2>
                  </div>
                  <span className="ready-badge">Ready</span>
                </div>

                <section className="card content-card">
                  <h3><span className="heading-symbol">S</span> Summary</h3>
                  <p className="summary-text">{studyMaterial.summary}</p>

                  <div className="divider" />

                  <h3><span className="heading-symbol">✓</span> Key points</h3>
                  <ul className="key-points">
                    {(studyMaterial.key_points || []).map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                </section>

                {questions.length > 0 && (
                  <section className="quiz-section" id="quiz">
                    <div className="quiz-heading">
                      <div>
                        <span className="step-label">STEP 2</span>
                        <h2>Test your knowledge</h2>
                        <p className="muted">
                          Select one answer for each question, then submit.
                        </p>
                      </div>
                      <div className="quiz-count">
                        <strong>{answeredCount}/{questions.length}</strong>
                        <span>answered</span>
                      </div>
                    </div>

                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${(answeredCount / questions.length) * 100}%`,
                        }}
                      />
                    </div>

                    {submitted && (
                      <div className="score-card">
                        <span className="score-label">YOUR SCORE</span>
                        <strong>{score} / {questions.length}</strong>
                        <p>
                          {score === questions.length
                            ? "Perfect score! Excellent work."
                            : score >= Math.ceil(questions.length * 0.6)
                              ? "Good work! Review the explanations to improve further."
                              : "Keep practising. Review the answers and try again."}
                        </p>
                      </div>
                    )}

                    <form onSubmit={submitQuiz} className="quiz-form">
                      {questions.map((question, questionIndex) => {
                        const correct = answers[questionIndex] === question.correct_answer;

                        return (
                          <article className="card question-card" key={questionIndex}>
                            <div className="question-meta">
                              <span>QUESTION {questionIndex + 1}</span>
                              {submitted && (
                                <span className={correct ? "result-correct" : "result-wrong"}>
                                  {correct ? "Correct" : "Incorrect"}
                                </span>
                              )}
                            </div>

                            <h3>{question.question}</h3>

                            <div className="options-list">
                              {(question.options || []).map((option, optionIndex) => {
                                const selected = answers[questionIndex] === optionIndex;
                                const isCorrect =
                                  submitted && optionIndex === question.correct_answer;
                                const isWrongSelection =
                                  submitted && selected && !correct;

                                let optionClass = "answer-option";
                                if (selected) optionClass += " selected";
                                if (isCorrect) optionClass += " answer-correct";
                                if (isWrongSelection) optionClass += " answer-wrong";

                                return (
                                  <label className={optionClass} key={optionIndex}>
                                    <input
                                      type="radio"
                                      name={`question-${questionIndex}`}
                                      checked={selected}
                                      disabled={submitted}
                                      onChange={() =>
                                        selectAnswer(questionIndex, optionIndex)
                                      }
                                    />
                                    <span className="option-letter">
                                      {String.fromCharCode(65 + optionIndex)}
                                    </span>
                                    <span className="option-text">{option}</span>
                                  </label>
                                );
                              })}
                            </div>

                            {submitted && (
                              <div className="explanation">
                                <strong>
                                  Correct answer:{" "}
                                  {question.options?.[question.correct_answer]}
                                </strong>
                                <p>{question.explanation}</p>
                              </div>
                            )}
                          </article>
                        );
                      })}

                      {!submitted ? (
                        <button
                          className="button button-primary button-full"
                          type="submit"
                          disabled={answeredCount !== questions.length}
                        >
                          Submit quiz
                        </button>
                      ) : (
                        <button
                          className="button button-primary button-full"
                          type="button"
                          onClick={retryQuiz}
                        >
                          Try again
                        </button>
                      )}
                    </form>
                  </section>
                )}
              </section>
            )}
          </>
        )}

        {message && <div className="notice notice-success" role="status">{message}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
      </main>

      <footer className="footer">
        <strong>Quiz Craft</strong>
        <span>Learn at your own pace.</span>
      </footer>
    </div>
  );
}

export default App;
