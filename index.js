async function getGrants() {
    const response = await fetch("https://api.grants.gov/v1/api/search2", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            keyword: "",
            rows: 5
        })
    });

    const result = await response.json();

    for (const grant of result.data.oppHits) {
        console.log(grant.title);
    }
}

getGrants();