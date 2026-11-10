const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});

test('explicação abre por teclado e Escape fecha sem retirar o foco',async({page})=>{
 await page.goto('/index.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const term=page.locator('.glossario-termo[role="button"]').first();
 await term.focus();
 const content=()=>term.evaluate(el=>getComputedStyle(el,'::after').content);
 expect(await content()).toBe('none');
 await page.keyboard.press('Enter');
 await expect(term).toHaveAttribute('aria-expanded','true');
 expect(await content()).not.toBe('none');
 await page.keyboard.press('Space');
 await expect(term).toHaveAttribute('aria-expanded','false');
 await page.keyboard.press('Enter');
 await page.keyboard.press('Escape');
 await expect(term).toBeFocused();
 await expect(term).toHaveAttribute('aria-expanded','false');
 expect(await content()).toBe('none');
});
