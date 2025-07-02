// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Auto-hide alerts after 5 seconds
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.classList.add('fade');
      setTimeout(() => {
        alert.style.display = 'none';
      }, 500);
    }, 5000);
  });

  // Handle date inputs - default to a week ago if not set
  const dateInputs = document.querySelectorAll('input[type="date"]');
  dateInputs.forEach(input => {
    if (!input.value) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      input.value = oneWeekAgo.toISOString().split('T')[0];
    }
  });

  // Make table rows clickable if they have links
  const activityTables = document.querySelectorAll('.activity-report table');
  activityTables.forEach(table => {
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const links = row.querySelectorAll('a');
      if (links.length > 0) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function(e) {
          // Don't trigger if they clicked the actual link or if text is selected
          if (e.target.tagName !== 'A' && window.getSelection().toString().length === 0) {
            links[0].click();
          }
        });
      }
    });
  });
  
  // Multi-user functionality
  setupMultiUserForm();
  
  function setupMultiUserForm() {
    const usernameInput = document.getElementById('username');
    const addUsernameBtn = document.getElementById('addUsernameBtn');
    const usernameChips = document.getElementById('username-chips');
    const usernamesHidden = document.getElementById('usernames');
    const recentUsernameBtns = document.querySelectorAll('.recent-username-btn');
    
    if (!usernameInput || !addUsernameBtn || !usernameChips || !usernamesHidden) {
      return; // Not on the form page
    }
    
    // Track usernames
    let usernames = [];
    
    // Add username when button is clicked
    addUsernameBtn.addEventListener('click', function() {
      addUsername();
    });
    
    // Also add username when Enter is pressed
    usernameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); // Prevent form submission
        addUsername();
      }
    });
    
    // Handle recent username button clicks
    recentUsernameBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const username = this.getAttribute('data-username');
        if (username) {
          // Either add directly to chips or set in input field
          if (!usernames.includes(username)) {
            // If not already in the list, add it
            usernameInput.value = username;
            addUsername();
          } else {
            // Flash the chip to indicate it's already added
            const existingChip = Array.from(usernameChips.children)
              .find(chip => chip.querySelector('span').textContent === username);
              
            if (existingChip) {
              existingChip.style.backgroundColor = '#ffe066';
              setTimeout(() => {
                existingChip.style.backgroundColor = '';
              }, 1000);
            }
          }
        }
      });
    });
    
    // Function to add a username
    function addUsername() {
      const username = usernameInput.value.trim();
      
      if (username && !usernames.includes(username)) {
        // Add to the array
        usernames.push(username);
        
        // Create chip element
        const chip = document.createElement('div');
        chip.className = 'username-chip';
        chip.innerHTML = `
          <span>${username}</span>
          <button type="button" class="remove-username" data-username="${username}">
            <i class="bi bi-x"></i>
          </button>
        `;
        
        // Add remove functionality
        const removeBtn = chip.querySelector('.remove-username');
        removeBtn.addEventListener('click', function() {
          const usernameToRemove = this.getAttribute('data-username');
          usernames = usernames.filter(name => name !== usernameToRemove);
          chip.remove();
          updateHiddenField();
        });
        
        // Add to the DOM
        usernameChips.appendChild(chip);
        
        // Clear input field
        usernameInput.value = '';
        
        // Update hidden field
        updateHiddenField();
      }
    }
    
    // Update the hidden field with comma-separated usernames
    function updateHiddenField() {
      usernamesHidden.value = usernames.join(',');
      
      // If we have usernames in the list, make the main username field optional
      if (usernames.length > 0) {
        usernameInput.required = false;
      } else {
        usernameInput.required = true;
      }
    }
    
    // Handle pre-populated username
    if (usernameInput.value) {
      addUsername();
    }
  }

  // Handle activity form submission with simple loading screen
  const activityForm = document.getElementById('activity-form');
  if (activityForm) {
    activityForm.addEventListener('submit', function(e) {
      // Only intercept if we have the progress container
      const progressContainer = document.getElementById('progress-container');
      const formContainer = document.getElementById('form-container');
      
      if (progressContainer && formContainer) {
        e.preventDefault();
        
        // Show loading screen instead of form
        formContainer.style.display = 'none';
        progressContainer.style.display = 'block';
        
        // Add a small delay before submitting to ensure the loading screen appears
        setTimeout(() => {
          activityForm.submit();
        }, 500);
      }
      // If no progress container, form submits normally
    });
  }
});

// No specialized progress functions needed - 
// we're just showing a simple loading animation now