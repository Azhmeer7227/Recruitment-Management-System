const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const port = 3000;

// ===== Middleware =====
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Session Setup =====
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false
}));

// ===== MySQL Connection =====
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'recruitment_db'
});

db.connect((err) => {
  if (err) throw err;
  console.log('MySQL Connected');
});

// ===== User Registration =====
app.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);

  const query = 'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)';
  db.query(query, [name, email, hashedPassword, role], (err) => {
    if (err) {
      return res.send('<script>alert("Invalid email or password!"); window.location.href = "/register.html";</script>');
    }
    res.redirect('/login.html');
  });
});

// ===== User Login =====
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const query = 'SELECT * FROM users WHERE email = ?';

  db.query(query, [email], (err, results) => {
    if (err) throw err;

    if (results.length === 0) {
      return res.send('<script>alert("Invalid email or password!"); window.location.href = "/login.html";</script>');
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.send('<script>alert("Invalid email or password!"); window.location.href = "/login.html";</script>');
    }

    req.session.userId = user.id;
    req.session.role = user.role;

    res.redirect(user.role === 'candidate' ? '/candidate-home.html' : '/recruiter-home.html');
  });
});

// ===== Candidate Profile (View & Edit) =====
app.get('/profile', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  db.query('SELECT name, email, bio, skills, experience FROM users WHERE id = ?', [userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching profile' });
    res.json(results[0]);
  });
});

app.post('/profile', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const { bio, skills, experience } = req.body;
  db.query('UPDATE users SET bio = ?, skills = ?, experience = ? WHERE id = ?', [bio, skills, experience, userId], (err) => {
    if (err) return res.status(500).json({ message: 'Error updating profile' });
    res.json({ message: 'Profile updated successfully' });
  });
});

// ===== Recruiter: View Jobs Posted =====
app.get('/recruiter/jobs', (req, res) => {
  const recruiterId = req.session.userId;
  if (!recruiterId) return res.status(401).json({ message: 'Unauthorized' });

  db.query('SELECT * FROM jobs WHERE recruiter_id = ?', [recruiterId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching jobs' });
    res.json(results);
  });
});

// ===== Recruiter: View Applicants for a Job =====
app.get('/recruiter/jobs/:jobId/applicants', (req, res) => {
  const recruiterId = req.session.userId;
  const jobId = req.params.jobId;

  if (!recruiterId) return res.status(401).json({ message: 'Unauthorized' });

  const query = `
    SELECT users.id, users.name, users.email, users.bio, users.skills, users.experience
    FROM applications
    JOIN users ON applications.candidate_id = users.id
    WHERE applications.job_id = ?
  `;
  db.query(query, [jobId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching applicants' });
    res.json(results);
  });
});

// ===== Recruiter: View Candidate Profile =====
app.get('/applicant/:candidateId', (req, res) => {
  const recruiterId = req.session.userId;
  if (!recruiterId) return res.status(401).json({ message: 'Unauthorized' });

  db.query('SELECT name, email, bio, skills, experience FROM users WHERE id = ?', [req.params.candidateId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching profile' });
    res.json(results[0]);
  });
});

// ===== Post a Job (Recruiter Only) =====
app.post('/post-job', (req, res) => {
  const recruiterId = req.session.userId;
  const { title, description, company } = req.body;

  if (!recruiterId) return res.status(401).json({ message: 'Unauthorized: Please log in.' });

  const query = 'INSERT INTO jobs (title, description, company, recruiter_id) VALUES (?, ?, ?, ?)';
  db.query(query, [title, description, company, recruiterId], (err) => {
    if (err) return res.status(500).send('Error posting job');
    res.send('<script>alert("Job posted successfully!"); window.location.href = "/recruiter-home.html";</script>');
  });
});

// ===== View Available Jobs (Candidates) =====
app.get('/available-jobs', (req, res) => {
  db.query('SELECT * FROM jobs', (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching jobs' });
    res.json(results);
  });
});

// ===== Apply for a Job =====
app.post('/apply-job/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const candidateId = req.session.userId;

  if (!candidateId) return res.status(401).json({ message: 'You must be logged in to apply for a job' });

  const checkQuery = 'SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?';
  db.query(checkQuery, [candidateId, jobId], (err, results) => {
    if (err) return res.status(500).send('Error checking application status');
    if (results.length > 0) return res.send('<script>alert("You have already applied for this job"); window.location.href = "/candidate-home.html"; </script>');

    const insertQuery = 'INSERT INTO applications (candidate_id, job_id, applied_at) VALUES (?, ?, NOW())';
    db.query(insertQuery, [candidateId, jobId], (err) => {
      if (err) return res.status(500).send('Error applying for the job');
      res.redirect('/candidate-home.html');
    });
  });
});

// ===== View Applied Jobs (Candidates) =====
app.get('/applied-jobs', (req, res) => {
  const candidateId = req.session.userId;
  if (!candidateId) return res.status(401).json({ message: 'Unauthorized' });

  const query = `
    SELECT jobs.id, jobs.title, jobs.description, jobs.company, applications.applied_at
    FROM applications
    INNER JOIN jobs ON applications.job_id = jobs.id
    WHERE applications.candidate_id = ?
  `;
  db.query(query, [candidateId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching applied jobs' });
    res.json(results);
  });
});

// ===== Logout Route =====
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/index.html'));
});

// ===== Start Server =====
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
