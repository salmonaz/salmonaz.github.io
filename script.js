const regex =
  /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
function takeEmail() {
  let email = document.getElementById("user-email");
  if (!regex.test(email.value)) {
    alert("wrong imput type");
  } else {
    console.log("input", email.value);
    document.getElementById("form").classList.add("d-none");
    document.getElementById("info").classList.remove("d-none");
  }
}
function showMore(button) {
  button.nextElementSibling.classList.toggle("d-none");
}
